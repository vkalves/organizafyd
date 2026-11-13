// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), copy: vi.fn() }));
vi.mock("./api", () => ({ publisherRequest: mocks.request }));
vi.mock("./library-sharing-api", () => ({ importSharedMedia: mocks.copy }));
import { importSharedLibrary } from "./library-sharing-batch";
beforeEach(() => { vi.clearAllMocks(); mocks.copy.mockReset().mockResolvedValue(undefined); });
const callbacks = (alreadyImported: string[] = []) => ({ alreadyImported, onImported: vi.fn(), onProgress: vi.fn() });
describe("import all shared media", () => {
  it("copies every page, skips completed media and reports progress", async () => {
    mocks.request.mockImplementation(async (_action, { offset }) => offset === 0
      ? Array.from({ length: 50 }, (_, i) => ({ id: `m${i}` })) : [{ id: "m50" }, { id: "m51" }]);
    const options = callbacks(["m0"]);
    expect(await importSharedLibrary("owner", "recipient", options)).toEqual({ imported: 51, skipped: 1, failures: [] });
    expect(mocks.request).toHaveBeenCalledWith("library_browse", { owner_id: "owner", offset: 50 });
    expect(mocks.copy).toHaveBeenCalledTimes(51);
    expect(mocks.copy).toHaveBeenLastCalledWith("owner", "m51", "recipient");
    expect(options.onProgress).toHaveBeenLastCalledWith({ completed: 51, total: 51 });
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
    mocks.request.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ id: String(i) }))).mockRejectedValueOnce(new Error("Acesso retirado"));
    await expect(importSharedLibrary("owner", "recipient", callbacks())).rejects.toThrow("Acesso retirado");
    expect(mocks.copy).not.toHaveBeenCalled();
  });
  it("handles empty libraries", async () => {
    mocks.request.mockResolvedValue([]);
    expect(await importSharedLibrary("owner", "recipient", callbacks())).toEqual({ imported: 0, skipped: 0, failures: [] });
    expect(mocks.copy).not.toHaveBeenCalled();
  });
});
