// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), upload: vi.fn(), remove: vi.fn(), insert: vi.fn() }));
vi.mock("./api", () => ({ publisherRequest: mocks.request }));
vi.mock("@/lib/storage", () => ({ storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ insert: mocks.insert }) } }));
import { importSharedMedia } from "./library-sharing-api";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ url: "https://signed.test/media", kind: "posts", folder: "Viagens", caption: "Praia" });
  mocks.upload.mockResolvedValue({ error: null }); mocks.insert.mockResolvedValue({ error: null }); mocks.remove.mockResolvedValue({ error: null });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Blob(["image"], { type: "image/jpeg" }))));
});
describe("shared media copy", () => {
  it("stores an independent copy under the recipient and retains captions and folders", async () => {
    await importSharedMedia("owner", "media", "recipient");
    expect(mocks.request).toHaveBeenCalledWith("library_download", { owner_id: "owner", media_id: "media" });
    expect(mocks.upload.mock.calls[0][0]).toMatch(/^recipient\/.*\.jpg$/);
    expect(mocks.insert).toHaveBeenCalledWith({ user_id: "recipient", url: `storage://${mocks.upload.mock.calls[0][0]}`, kind: "posts", folder: "Viagens", caption: "Praia" });
  });
  it("does not register media when quota enforcement rejects upload", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "Limite de armazenamento atingido." } });
    await expect(importSharedMedia("owner", "media", "recipient")).rejects.toThrow("Limite de armazenamento");
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("cleans up the copied file if library registration fails", async () => {
    mocks.insert.mockResolvedValue({ error: { message: "database error" } });
    await expect(importSharedMedia("owner", "media", "recipient")).rejects.toThrow("registrar a cópia");
    expect(mocks.remove).toHaveBeenCalledWith([mocks.upload.mock.calls[0][0]]);
  });
});
