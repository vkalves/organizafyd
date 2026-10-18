import { Blob as NodeBlob } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanMedia } from "./clean-media";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("photo cleaning", () => {
  it("uploads reconstructed pixels under a neutral name and date", async () => {
    const close = vi.fn();
    const draw = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 120, height: 80, close }),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: draw,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) =>
        callback(new NodeBlob([new Uint8Array([255,216,255,218,0,2,10,255,217])], { type: "image/jpeg" }) as unknown as Blob),
    );
    const result = await cleanMedia(
      new File(["EXIF GPS PRIVATE"], "alice-paris.jpg", {
        type: "image/jpeg",
        lastModified: 123456789,
      }),
    );
    expect(result.name).toMatch(/^midia-.*\.jpg$/);
    expect(result.lastModified).toBe(0);
    expect(result.size).toBe(9);
    expect(draw).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
  it("blocks malformed encoder output instead of returning an unchecked file", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({width: 1, height: 1, close: vi.fn()}));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({drawImage: vi.fn()} as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new NodeBlob(["PRIVATE invalid output"]) as unknown as Blob));
    await expect(cleanMedia(new File(["original"], "photo.jpg", {type: "image/jpeg"}))).rejects.toThrow("Nada foi enviado");
  });
  it("fails closed if decoding fails, without returning the original", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("Invalid image")),
    );
    await expect(
      cleanMedia(new File(["bad"], "a.jpg", { type: "image/jpeg" })),
    ).rejects.toThrow("Limpeza não concluída");
  });
});
