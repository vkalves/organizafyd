import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  clean: vi.fn(),
  upload: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/features/x/clean-media", () => ({ cleanMedia: mocks.clean }));
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
});
