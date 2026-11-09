import { beforeAll, describe, expect, it, vi } from "vitest";
import { accountHandler, safePhotoUrl, type AccountRepository } from "../../../supabase/functions/instagram-accounts/handler";
beforeAll(() => {
  if (!("timeout" in AbortSignal)) Object.defineProperty(AbortSignal, "timeout", { configurable: true, value: () => new AbortController().signal });
});
const user = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
function setup() {
  const repo: AccountRepository = {
    authenticate: vi.fn(async () => user),
    connections: vi.fn(async () => [{ account_id: id, graph_id: "123456", secret_id: "vault-id", provider: "facebook" }]),
    photos: vi.fn(async () => []),
    token: vi.fn(async () => "private-test-token"),
    savePhoto: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  };
  const graph = vi.fn(async () => new Response(JSON.stringify({ id: "123456", profile_picture_url: "https://cdn.example.com/avatar.jpg" }), { status: 200 }));
  const handler = accountHandler(repo, graph as typeof fetch);
  const request = (body: unknown, auth = true) => handler(new Request("https://example.com", { method: "POST", headers: auth ? { Authorization: "Bearer verified-jwt" } : {}, body: JSON.stringify(body) }));
  return { repo, graph, request };
}
describe("Instagram account management authorization and photos", () => {
  it("rejects missing and invalid sessions before reading account data", async () => {
    const { repo, request } = setup();
    expect((await request({ action: "profiles", account_ids: [id] }, false)).status).toBe(401);
    vi.mocked(repo.authenticate).mockResolvedValue(null);
    expect((await request({ action: "disconnect", account_id: id })).status).toBe(401);
    expect(repo.connections).not.toHaveBeenCalled(); expect(repo.disconnect).not.toHaveBeenCalled();
  });
  it("rejects accounts outside the authenticated owner before reading credentials", async () => {
    const { repo, graph, request } = setup(); vi.mocked(repo.connections).mockResolvedValue([]);
    expect((await request({ action: "profiles", account_ids: [id] })).status).toBe(404);
    expect(repo.token).not.toHaveBeenCalled(); expect(graph).not.toHaveBeenCalled();
  });
  it("stores the official photo and keeps the access token out of URLs and responses", async () => {
    const { repo, graph, request } = setup(); const result = await request({ action: "profiles", account_ids: [id] });
    expect(await result.json()).toEqual({ photos: [{ account_id: id, avatar_url: "https://cdn.example.com/avatar.jpg" }] });
    expect(repo.savePhoto).toHaveBeenCalledWith(user, id, "https://cdn.example.com/avatar.jpg");
    const [url, init] = vi.mocked(graph).mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.hostname).toBe("graph.facebook.com"); expect(url.searchParams.has("access_token")).toBe(false);
    expect(init.headers).toEqual({ Authorization: "Bearer private-test-token" });
  });
  it("uses a cached image unless refresh is requested", async () => {
    const { repo, graph, request } = setup(); vi.mocked(repo.photos).mockResolvedValue([{ account_id: id, avatar_url: "https://cdn.example.com/cached.jpg" }]);
    await request({ action: "profiles", account_ids: [id] }); expect(graph).not.toHaveBeenCalled();
    await request({ action: "profiles", account_ids: [id], refresh: true }); expect(graph).toHaveBeenCalledTimes(1);
  });
  it("keeps cached images when Meta denies access and never removes an account automatically", async () => {
    const { repo, graph, request } = setup(); vi.mocked(repo.photos).mockResolvedValue([{ account_id: id, avatar_url: "https://cdn.example.com/cached.jpg" }]);
    graph.mockResolvedValue(new Response(JSON.stringify({ error: { code: 190 } }), { status: 400 }));
    expect(await (await request({ action: "profiles", account_ids: [id], refresh: true })).json()).toEqual({ photos: [{ account_id: id, avatar_url: "https://cdn.example.com/cached.jpg" }] });
    expect(repo.disconnect).not.toHaveBeenCalled(); expect(repo.savePhoto).not.toHaveBeenCalled();
  });
  it("rejects insecure photos and mismatched Meta identities", async () => {
    const { repo, graph, request } = setup();
    graph.mockResolvedValue(new Response(JSON.stringify({ id: "other", profile_picture_url: "https://cdn.example.com/wrong.jpg" })));
    expect(await (await request({ action: "profiles", account_ids: [id] })).json()).toEqual({ photos: [{ account_id: id, avatar_url: null }] });
    expect(repo.savePhoto).not.toHaveBeenCalled();
    expect(safePhotoUrl("javascript:alert(1)")).toBeNull(); expect(safePhotoUrl("http://cdn.example.com/a.jpg")).toBeNull();
    expect(safePhotoUrl("https://secret@cdn.example.com/a.jpg")).toBeNull();
  });
  it("uses only the verified user for removal and maps in-flight publications to a recoverable conflict", async () => {
    const { repo, request } = setup();
    expect((await request({ action: "disconnect", account_id: id, user_id: "attacker" })).status).toBe(200);
    expect(repo.disconnect).toHaveBeenCalledWith(user, id);
    vi.mocked(repo.disconnect).mockRejectedValue(new Error("account_busy"));
    const result = await request({ action: "disconnect", account_id: id }); expect(result.status).toBe(409); expect(await result.json()).toEqual({ error: "account_busy" });
  });
  it("limits profile batches and validates account identifiers", async () => {
    const { repo, request } = setup();
    expect((await request({ action: "profiles", account_ids: Array(11).fill(id) })).status).toBe(400);
    expect((await request({ action: "disconnect", account_id: "not-a-uuid" })).status).toBe(400);
    expect(repo.connections).not.toHaveBeenCalled(); expect(repo.disconnect).not.toHaveBeenCalled();
  });
});
