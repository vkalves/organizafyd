// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { librarySharing, type LibrarySharingDatabase } from "../../../supabase/functions/instagram-publisher/library-sharing";
const owner = "11111111-1111-4111-8111-111111111111", user = "22222222-2222-4222-8222-222222222222";
const media = { url: `storage://${owner}/video.mp4`, kind: "posts", caption: "Legenda", folder: "Viagens" };
const input = { action: "library_import", owner_id: owner, media_id: "source-media" };
function setup(results: unknown[] = [{ owner_id: owner }, media, null], insertError = false) {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(),
    insert: vi.fn(async () => ({ data: null, error: insertError ? { code: "XX000" } : null })),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: results.shift(), error: null }).then(resolve),
  };
  const db = { from: vi.fn(() => query) } as unknown as LibrarySharingDatabase;
  const storage = { copy: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({ error: null }) };
  const sign = vi.fn();
  return { query, storage, sign, run: (body = input) => librarySharing(db, user, body, sign, storage) };
}
describe("shared library server-side import", () => {
  it("makes an independent recipient copy, preserving folder, caption and media kind", async () => {
    const { run, storage, query, sign } = setup();
    expect(await run()).toEqual({ ok: true });
    const [source, destination] = storage.copy.mock.calls[0];
    expect(source).toBe(`${owner}/video.mp4`);
    expect(destination).toMatch(new RegExp(`^${user}/[0-9a-f-]{36}\\.mp4$`));
    expect(query.insert).toHaveBeenCalledWith({ user_id: user, url: `storage://${destination}`, kind: "posts", caption: "Legenda", folder: "Viagens" });
    expect(query.eq).toHaveBeenCalledWith("user_id", owner);
    expect(query.eq).toHaveBeenCalledWith("retired", false);
    expect(sign).not.toHaveBeenCalled();
  });
  it("denies imports without a current sharing grant", async () => {
    const { run, storage, query } = setup([null]);
    await expect(run()).rejects.toThrow("library_access_denied");
    expect(storage.copy).not.toHaveBeenCalled(); expect(query.insert).not.toHaveBeenCalled();
    expect(query.eq).toHaveBeenCalledWith("recipient_id", user);
  });
  it("does not copy missing or retired media", async () => {
    const { run, storage } = setup([{ owner_id: owner }, null]);
    await expect(run()).rejects.toThrow("media_unavailable"); expect(storage.copy).not.toHaveBeenCalled();
  });
  it.each([`storage://${user}/video.mp4`, `storage://${owner}/../video.mp4`, "https://external.example/video.mp4"])("rejects a source outside the granted library: %s", async url => {
    const { run, storage } = setup([{ owner_id: owner }, { ...media, url }]);
    await expect(run()).rejects.toThrow("invalid_media_owner"); expect(storage.copy).not.toHaveBeenCalled();
  });
  it("never registers a copy when quota prevents it", async () => {
    const { run, storage, query } = setup();
    storage.copy.mockResolvedValue({ error: { message: "Limite de armazenamento atingido." } });
    await expect(run()).rejects.toThrow("storage_quota_exceeded");
    expect(query.insert).not.toHaveBeenCalled(); expect(storage.remove).not.toHaveBeenCalled();
  });
  it("removes only the new file if registration fails", async () => {
    const { run, storage } = setup(undefined, true);
    await expect(run()).rejects.toThrow("library_import_failed");
    expect(storage.remove).toHaveBeenCalledWith([storage.copy.mock.calls[0][1]]);
  });
  it("lists IDs in pages of 500 while keeping the regular browser pages at 50", async () => {
    const { run, query } = setup([{ owner_id: owner }, []]);
    await run({ ...input, action: "library_browse", ids_only: true, offset: 500 } as typeof input);
    expect(query.select).toHaveBeenCalledWith("id"); expect(query.range).toHaveBeenCalledWith(500, 999);
    const normal = setup([{ owner_id: owner }, []]);
    await normal.run({ ...input, action: "library_browse" });
    expect(normal.query.range).toHaveBeenCalledWith(0, 49);
  });
});
