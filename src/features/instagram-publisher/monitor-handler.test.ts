import { describe, expect, it, vi } from "vitest";
import {
  monitorHandler,
  type MonitorRepository,
} from "../../../supabase/functions/instagram-monitor/handler";
const user = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
function setup() {
  const repo: MonitorRepository = {
    authenticate: vi.fn(async () => user),
    workerKey: vi.fn(async () => "worker-key"),
    worker: vi.fn(async () => ({ checked: 2, failures: 0 })),
    status: vi.fn(async () => ({ health: [], alerts: [] })),
    read: vi.fn(async () => 2),
    refresh: vi.fn(async () => "checked" as const),
  };
  const handler = monitorHandler(
    repo,
    new Set(["https://www.organizafy.site"]),
  );
  const request = (
    body: unknown,
    headers: Record<string, string> = { Authorization: "Bearer user-jwt" },
  ) =>
    handler(
      new Request("https://example.test", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
  return { repo, handler, request };
}
describe("Instagram monitor endpoint", () => {
  it("rejects missing and invalid sessions before reading or mutating user data", async () => {
    const { repo, request } = setup();
    expect((await request({ action: "status" }, {})).status).toBe(401);
    vi.mocked(repo.authenticate).mockResolvedValue(null);
    expect((await request({ action: "read_all" })).status).toBe(401);
    expect(repo.status).not.toHaveBeenCalled();
    expect(repo.read).not.toHaveBeenCalled();
  });
  it("binds reads and mutations to the authenticated owner, ignoring supplied ownership", async () => {
    const { repo, request } = setup();
    await request({ action: "status", user_id: "attacker" });
    await request({ action: "read", id, user_id: "attacker" });
    expect(repo.status).toHaveBeenCalledWith(user);
    expect(repo.read).toHaveBeenCalledWith(user, id);
    expect(await (await request({ action: "read_all" })).json()).toEqual({
      ok: true,
      updated: 2,
    });
    expect(repo.read).toHaveBeenLastCalledWith(user);
  });
  it("propagates database failures instead of reporting successful bulk reads", async () => {
    const { repo, request } = setup();
    vi.mocked(repo.read).mockRejectedValue(new Error("db"));
    expect((await request({ action: "read_all" })).status).toBe(500);
  });
  it("validates IDs and payloads, and does not expose other owners through refresh", async () => {
    const { repo, request } = setup();
    expect((await request(null)).status).toBe(400);
    expect((await request({ action: "read", id: "invalid" })).status).toBe(400);
    expect((await request({ action: "refresh", id: "invalid" })).status).toBe(
      400,
    );
    expect(repo.refresh).not.toHaveBeenCalled();
    vi.mocked(repo.refresh).mockResolvedValue("not_found");
    expect(
      (await request({ action: "refresh", id, user_id: "attacker" })).status,
    ).toBe(404);
    expect(repo.refresh).toHaveBeenCalledWith(user, id);
  });
  it("returns cooldown and in-flight check statuses without claiming a new result", async () => {
    const { repo, request } = setup();
    for (const status of ["recent", "busy"] as const) {
      vi.mocked(repo.refresh).mockResolvedValue(status);
      expect(await (await request({ action: "refresh", id })).json()).toEqual({
        status,
      });
    }
  });
  it("requires the separate worker secret, and returns 503 for infrastructure failures", async () => {
    const { repo, request } = setup();
    expect((await request({ action: "worker" })).status).toBe(401);
    expect(repo.worker).not.toHaveBeenCalled();
    vi.mocked(repo.worker).mockResolvedValue({ checked: 1, failures: 1 });
    expect(
      (await request({ action: "worker" }, { "x-worker-secret": "worker-key" }))
        .status,
    ).toBe(503);
    expect(repo.authenticate).not.toHaveBeenCalled();
  });
});
