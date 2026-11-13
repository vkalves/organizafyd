// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Media } from "./flows-api";
const mocks = vi.hoisted(() => ({ load: vi.fn(), used: vi.fn(), download: vi.fn() }));
vi.mock("./flows-api", () => ({ loadLibraryMedia: mocks.load, mediaInUse: mocks.used }));
vi.mock("@/lib/storage", () => ({ storage: { from: () => ({ download: mocks.download }) } }));
import { scanDuplicateMedia } from "./duplicate-media";
const media = (id: string, changes: Partial<Media> = {}): Media => ({ id, user_id: "user", url: `storage://user/${id}.jpg`, kind: "posts", folder: "", caption: "", created_at: "2026-01-01", retired: false, ...changes });
const options = () => ({ signal: new AbortController().signal, onProgress: vi.fn() });
beforeEach(() => {
  vi.clearAllMocks(); mocks.used.mockReset().mockResolvedValue(false);
  mocks.load.mockResolvedValue([media("a"), media("b", { folder: "Outra pasta", caption: "Outra legenda" }), media("c")]);
  mocks.download.mockImplementation(async (path: string) => ({ data: new Blob([path.includes("c.jpg") ? "different bytes" : "same bytes"]), error: null }));
});
describe("exact duplicate media scan", () => {
  it("compares bytes across names, folders and captions, preserving the oldest copy and distinct files", async () => {
    const progress = options();
    const scan = await scanDuplicateMedia("user", progress);
    expect(scan.duplicates.map((m) => m.id)).toEqual(["b"]);
    expect(scan).toMatchObject({ total: 3, groups: 1, protected: 0, failures: [] });
    expect(progress.onProgress).toHaveBeenLastCalledWith(3, 3);
  });
  it("keeps an in-use newer copy instead of an unused oldest copy", async () => {
    mocks.used.mockImplementation(async (id) => id === "b");
    expect((await scanDuplicateMedia("user", options())).duplicates.map((m) => m.id)).toEqual(["a"]);
  });
  it("preserves every in-use copy and removes only unused redundant copies", async () => {
    mocks.load.mockResolvedValue([media("a"), media("b"), media("d")]);
    mocks.used.mockImplementation(async (id) => id === "a" || id === "b");
    const scan = await scanDuplicateMedia("user", options());
    expect(scan.protected).toBe(1); expect(scan.duplicates.map((m) => m.id)).toEqual(["d"]);
  });
  it("preserves unreadable files and entire groups whose references cannot be checked", async () => {
    mocks.download.mockImplementation(async (path: string) => path.includes("c.jpg") ? { data: null, error: new Error("download") } : { data: new Blob(["same bytes"]), error: null });
    mocks.used.mockRejectedValue(new Error("Não foi possível verificar o uso."));
    const scan = await scanDuplicateMedia("user", options());
    expect(scan.duplicates).toEqual([]); expect(scan.failures).toHaveLength(2);
  });
  it("rejects foreign paths without downloading them", async () => {
    mocks.load.mockResolvedValue([media("a", { user_id: "other", url: "storage://other/file.jpg" })]);
    const scan = await scanDuplicateMedia("user", options());
    expect(scan.failures).toHaveLength(1); expect(mocks.download).not.toHaveBeenCalled();
  });
  it("cancels scanning without producing deletion candidates", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(scanDuplicateMedia("user", { signal: controller.signal, onProgress: vi.fn() })).rejects.toThrow();
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
