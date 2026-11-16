// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), copy: vi.fn() }));
vi.mock("./api", () => ({ publisherRequest: mocks.request }));
vi.mock("./library-sharing-api", () => ({ importSharedMedia: mocks.copy }));
import { importSharedLibrary } from "./library-sharing-batch";
beforeEach(() => { vi.clearAllMocks(); mocks.copy.mockReset().mockResolvedValue(undefined); });
const callbacks = (alreadyImported: string[] = []) => ({ alreadyImported, onImported: vi.fn(), onProgress: vi.fn() });
describe("import all shared media", () => {
  it("bounds parallel copies to three and reports progress as each finishes", async () => {
    mocks.request.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ id: `m${i}` })));
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    let active = 0, peak = 0;
    mocks.copy.mockImplementation(async () => { active++; peak = Math.max(peak, active); await wait; active--; });
    const options = callbacks();
    const pending = importSharedLibrary("owner", "recipient", options);
    await vi.waitFor(() => expect(mocks.copy).toHaveBeenCalledTimes(3));
    release();
    expect(await pending).toEqual({ imported: 10, skipped: 0, failures: [] });
    expect(peak).toBe(3);
    expect(new Set(mocks.copy.mock.calls.map(call => call[1])).size).toBe(10);
    expect(options.onProgress.mock.calls.map(call => call[0].completed)).toEqual(Array.from({ length: 11 }, (_, i) => i));
  });
  it("copies every page, skips completed media and reports progress", async () => {
    mocks.request.mockImplementation(async (_action, { offset }) => offset === 0
      ? Array.from({ length: 500 }, (_, i) => ({ id: `m${i}` })) : [{ id: "m500" }, { id: "m501" }]);
    const options = callbacks(["m0"]);
    expect(await importSharedLibrary("owner", "recipient", options)).toEqual({ imported: 501, skipped: 1, failures: [] });
    expect(mocks.request).toHaveBeenCalledWith("library_browse", { owner_id: "owner", offset: 500, ids_only: true });
    expect(mocks.copy).toHaveBeenCalledTimes(501);
    expect(mocks.copy).toHaveBeenLastCalledWith("owner", "m501", "recipient");
    expect(options.onProgress).toHaveBeenLastCalledWith({ completed: 501, total: 501 });
  });
  it("keeps successful copies when one file fails and retries only remaining media", async () => {
    mocks.request.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    mocks.copy.mockRejectedValueOnce(new Error("Falha no arquivo"));
    const options = callbacks();
    const first = await importSharedLibrary("owner", "recipient", options);
    expect(first).toEqual({ imported: 2, skipped: 0, failures: [{ id: "a", message: "Falha no arquivo" }] });
    expect(options.onImported.mock.calls.flat()).toEqual(["b", "c"]);
    mocks.copy.mockClear();
    expect(await importSharedLibrary("owner", "recipient", callbacks(["b", "c"]))).toEqual({ imported: 1, skipped: 2, failures: [] });
    expect(mocks.copy).toHaveBeenCalledTimes(1);
    expect(mocks.copy).toHaveBeenCalledWith("owner", "a", "recipient");
  });
  it("does not start copying if loading a later page fails", async () => {
    mocks.request.mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => ({ id: String(i) }))).mockRejectedValueOnce(new Error("Acesso retirado"));
    await expect(importSharedLibrary("owner", "recipient", callbacks())).rejects.toThrow("Acesso retirado");
    expect(mocks.copy).not.toHaveBeenCalled();
  });
  it("handles empty libraries", async () => {
    mocks.request.mockResolvedValue([]);
    expect(await importSharedLibrary("owner", "recipient", callbacks())).toEqual({ imported: 0, skipped: 0, failures: [] });
    expect(mocks.copy).not.toHaveBeenCalled();
  });
});
