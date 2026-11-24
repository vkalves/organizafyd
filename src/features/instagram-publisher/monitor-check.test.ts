import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  checkAccount,
  type CheckRepository,
  type HealthRow,
} from "../../../supabase/functions/instagram-monitor/check";
beforeAll(() => {
  if (!("timeout" in AbortSignal)) {
    Object.defineProperty(AbortSignal, "timeout", {
      value: () => new AbortController().signal,
    });
  }
});
const row: HealthRow = {
  account_id: "a",
  user_id: "owner",
  state: "healthy",
  candidate: "healthy",
  failures: 0,
  lease: "lease",
  checked_at: null,
  next_check_at: new Date().toISOString(),
};
function setup() {
  const repo: CheckRepository = {
    connection: vi.fn(async () => ({
      graph_id: "123",
      secret_id: "secret",
      provider: "instagram",
    })),
    token: vi.fn(async () => "private-token"),
    save: vi.fn(async () => {}),
  };
  const graph = vi.fn(async () =>
    new Response(JSON.stringify({ id: "123" }), { status: 200 })
  );
  return { repo, graph };
}
describe("Meta health checks", () => {
  it("checks the owning connection and sends credentials only in Authorization", async () => {
    const { repo, graph } = setup();
    await checkAccount(repo, row, graph as typeof fetch);
    expect(repo.connection).toHaveBeenCalledWith("a", "owner");
    const [url, init] = graph.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.hostname).toBe("graph.instagram.com");
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(init.headers).toEqual({ Authorization: "Bearer private-token" });
    expect(repo.save).toHaveBeenCalledWith(
      row,
      expect.objectContaining({
        state: "healthy",
        failures: 0,
        error_code: null,
        last_healthy_at: expect.any(String),
      }),
    );
  });
  it("does not manufacture account alerts when Vault fails or a connection is deleted", async () => {
    const { repo, graph } = setup();
    vi.mocked(repo.token).mockRejectedValue(new Error("vault"));
    await expect(checkAccount(repo, row, graph as typeof fetch)).rejects
      .toThrow("vault");
    expect(repo.save).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
    vi.mocked(repo.connection).mockResolvedValue(null);
    await checkAccount(repo, row, graph as typeof fetch);
    expect(repo.save).not.toHaveBeenCalled();
  });
  it("requires reconnection for a missing token but no graph call", async () => {
    const { repo, graph } = setup();
    vi.mocked(repo.token).mockResolvedValue(null);
    await checkAccount(repo, row, graph as typeof fetch);
    expect(graph).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(
      row,
      expect.objectContaining({
        state: "reconnect",
        error_code: "credential_missing",
      }),
    );
  });
  it("does not misdiagnose a mismatched identity or unknown API error as an inaccessible profile", async () => {
    const { repo, graph } = setup();
    graph.mockResolvedValue(new Response(JSON.stringify({ id: "other" })));
    await checkAccount(repo, row, graph as typeof fetch);
    expect(repo.save).toHaveBeenLastCalledWith(
      row,
      expect.objectContaining({
        state: "healthy",
        candidate: "temporary",
        error_code: "identity_mismatch",
      }),
    );
    graph.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 999 } }), { status: 400 }),
    );
    await checkAccount(repo, row, graph as typeof fetch);
    expect(repo.save).toHaveBeenLastCalledWith(
      row,
      expect.objectContaining({ candidate: "temporary" }),
    );
  });
  it("confirms repeated unavailable errors and recovers on a valid response", async () => {
    const { repo, graph } = setup();
    graph.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 100 } }), { status: 400 }),
    );
    await checkAccount(
      repo,
      { ...row, candidate: "unavailable", failures: 1 },
      graph as typeof fetch,
    );
    expect(repo.save).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ state: "unavailable", failures: 2 }),
    );
    graph.mockResolvedValue(new Response(JSON.stringify({ id: "123" })));
    await checkAccount(
      repo,
      { ...row, state: "unavailable" },
      graph as typeof fetch,
    );
    expect(repo.save).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        state: "healthy",
        candidate: "healthy",
        failures: 0,
      }),
    );
  });
  it("synchronizes the real Instagram @username from Meta and accepts user_id identity on Instagram Login", async () => {
    const { repo, graph } = setup();
    const syncAccount = vi.fn(async () => {});
    repo.syncAccount = syncAccount;
    graph.mockResolvedValue(
      new Response(
        JSON.stringify({ id: "app-scoped-999", user_id: "123", username: "novo.handle_real" }),
        { status: 200 },
      ),
    );
    await checkAccount(repo, row, graph as typeof fetch);
    expect(repo.save).toHaveBeenCalledWith(
      row,
      expect.objectContaining({
        state: "healthy",
        failures: 0,
        error_code: null,
      }),
    );
    expect(syncAccount).toHaveBeenCalledWith("a", "owner", {
      username: "novo.handle_real",
    });
  });
});
