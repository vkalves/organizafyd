import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { preparePhoto } from "./api";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TikTok photo preparation", () => {
  it.each([
    [1600, 1200, 1080, 810],
    [2160, 3840, 608, 1080],
    [3000, 3000, 1080, 1080],
    [800, 600, 800, 600],
  ])("prepares %i × %i without cropping or upscaling", async (width, height, outWidth, outHeight) => {
    const close = vi.fn();
    const bitmap = { width, height, close };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(), drawImage, fillStyle: "",
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback) {
      expect(this.width).toBe(outWidth);
      expect(this.height).toBe(outHeight);
      callback(new Blob(["jpeg"], { type: "image/jpeg" }));
    });
    const result = await preparePhoto(new File(["source"], "source.png", { type: "image/png" }));
    expect(result.type).toBe("image/jpeg");
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, outWidth, outHeight);
    expect(close).toHaveBeenCalledOnce();
  });
});
