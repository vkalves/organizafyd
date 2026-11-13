import { describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
import { importReelFile } from "./reel-import";
describe("Reel import client", () => {
  it("returns a video File for the normal cleaning/upload pipeline", async () => {
    invoke.mockResolvedValue({ data: new Blob(["mp4"], { type: "video/mp4" }), error: null });
    const file = await importReelFile("https://instagram.com/reel/DY2PcmxiBE2/?igsh=tracking");
    expect(invoke).toHaveBeenCalledWith("instagram-reel-import", { body: { url: "https://www.instagram.com/reel/DY2PcmxiBE2/" } });
    expect(file.type).toBe("video/mp4"); expect(file.size).toBe(3); expect(file.lastModified).toBe(0);
  });
  it("shows provider and size errors without pretending the import succeeded", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: "reel_too_large" }) } } });
    await expect(importReelFile("https://instagram.com/reel/DY2PcmxiBE2/")).rejects.toThrow("100 MB");
    invoke.mockResolvedValue({ data: { error: "bad response" }, error: null });
    await expect(importReelFile("https://instagram.com/reel/DY2PcmxiBE2/")).rejects.toThrow("não disponibilizou");
  });
});
