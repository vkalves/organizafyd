import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  insert: vi.fn(),
  single: vi.fn(),
}));
vi.mock("./api", () => ({
  publisherRequest: vi.fn(),
  uploadMedia: mocks.upload,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: mocks.insert }) },
}));
import { addMedia } from "./flows-api";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.insert.mockReturnValue({ select: () => ({ single: mocks.single }) });
});
describe("Flow batch uploads", () => {
  it("keeps successful files, continues after a bad file, and reports every result immediately", async () => {
    const files = ["one.mp4", "bad.mp4", "three.mp4"].map(
      (name) => new File(["video"], name, { type: "video/mp4" }),
    );
    mocks.upload
      .mockResolvedValueOnce(["storage://u/one.mp4"])
      .mockRejectedValueOnce(new Error("Vídeo inválido"))
      .mockResolvedValueOnce(["storage://u/three.mp4"]);
    mocks.single
      .mockResolvedValueOnce({
        data: { id: "one", url: "storage://u/one.mp4" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: "three", url: "storage://u/three.mp4" },
        error: null,
      });
    const onSaved = vi.fn(),
      onItem = vi.fn();
    const result = await addMedia(files, "u", "posts", "", vi.fn(), {
      onSaved,
      onItem,
    });
    expect(result.ids).toEqual(["one", "three"]);
    expect(result.errors).toEqual([
      { name: "bad.mp4", message: "Vídeo inválido" },
    ]);
    expect(mocks.upload).toHaveBeenCalledTimes(3);
    expect(onSaved.mock.calls.map((c) => c[0].id)).toEqual(["one", "three"]);
    expect(onItem).toHaveBeenCalledWith(
      expect.objectContaining({ index: 1, status: "error" }),
    );
    expect(onItem).toHaveBeenCalledWith(
      expect.objectContaining({ index: 2, status: "done" }),
    );
  });
  it("continues if storage registration fails without reporting that file as ready", async () => {
    mocks.upload.mockResolvedValue(["storage://u/video.mp4"]);
    mocks.single
      .mockResolvedValueOnce({ data: null, error: new Error("db failed") })
      .mockResolvedValueOnce({ data: { id: "two" }, error: null });
    const result = await addMedia(
      [new File(["x"], "a.mp4"), new File(["x"], "b.mp4")],
      "u",
      "posts",
      "",
      vi.fn(),
    );
    expect(result.ids).toEqual(["two"]);
    expect(result.errors).toHaveLength(1);
  });
});
