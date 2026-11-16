// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./api", () => ({ publisherRequest: mocks.request }));
import { importSharedMedia } from "./library-sharing-api";
beforeEach(() => { vi.clearAllMocks(); mocks.request.mockResolvedValue({ ok: true }); });
describe("shared media server copy", () => {
  it("requests an authenticated server copy without downloading media bytes", async () => {
    const download = vi.spyOn(globalThis, "fetch");
    await importSharedMedia("owner", "media", "recipient");
    expect(mocks.request).toHaveBeenCalledWith("library_import", { owner_id: "owner", media_id: "media" });
    expect(download).not.toHaveBeenCalled();
    download.mockRestore();
  });
  it("preserves quota errors from the server", async () => {
    mocks.request.mockRejectedValue(new Error("Limite de armazenamento atingido."));
    await expect(importSharedMedia("owner", "media", "recipient")).rejects.toThrow("Limite de armazenamento");
  });
});
