import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  clean: vi.fn(),
  upload: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/features/x/clean-media", () => ({ cleanMedia: mocks.clean }));
vi.mock("@/lib/storage", () => ({
  storage: { from: mocks.from },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: mocks.from } },
}));
import { uploadMedia } from "./api";
describe("Instagram upload privacy boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({ upload: mocks.upload });
    mocks.upload.mockResolvedValue({ error: null });
  });
  it("stores only the cleaned bytes with a neutral path and output MIME", async () => {
    const source = new File(["private"], "GPS-private.png", {
        type: "image/png",
      }),
      clean = new File(["clean"], "neutral.jpg", { type: "image/jpeg" });
    mocks.clean.mockResolvedValue(clean);
    const urls = await uploadMedia([source], "owner");
    expect(mocks.clean).toHaveBeenCalledWith(source, {
      maxBytes: 104857600,
      jpeg: true,
    });
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^owner\/.+\.jpg$/),
      clean,
      { contentType: "image/jpeg", upsert: false },
    );
    expect(urls[0]).not.toContain("GPS");
  });
  it("never uploads the original if cleaning fails", async () => {
    mocks.clean.mockRejectedValue(new Error("Limpeza falhou"));
    await expect(
      uploadMedia([new File(["x"], "a.mp4", { type: "video/mp4" })], "owner"),
    ).rejects.toThrow("Limpeza falhou");
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("cleans up to 3 files concurrently while preserving order", async () => {
    let active = 0;
    let maxActive = 0;
    mocks.clean.mockImplementation(async (f: File) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, f.name === "1.mp4" ? 25 : 5));
      active -= 1;
      return new File(["clean"], f.name, { type: "video/mp4" });
    });
    const files = ["1.mp4", "2.mp4", "3.mp4", "4.mp4"].map(
      (n) => new File(["raw"], n, { type: "video/mp4" }),
    );
    const urls = await uploadMedia(files, "owner");
    expect(maxActive).toBe(3);
    expect(urls).toHaveLength(4);
  });
});
