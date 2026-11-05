import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ instances: [] as unknown[], exec: vi.fn() }));
vi.mock("@ffmpeg/ffmpeg", () => ({
  FFmpeg: class {
    loaded = false;
    load = vi.fn(async () => {
      this.loaded = true;
    });
    writeFile = vi.fn();
    readFile = vi.fn(async () => new Uint8Array([1, 2, 3]));
    deleteFile = vi.fn();
    terminate = vi.fn();
    on = vi.fn();
    off = vi.fn();
    exec = mocks.exec;
    constructor() {
      mocks.instances.push(this);
    }
  },
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.clearAllMocks();
  mocks.instances.length = 0;
  mocks.exec.mockResolvedValue(0);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});
const file = { arrayBuffer: async () => new ArrayBuffer(2) } as File;
it("reuses the encoder for a batch, cleans virtual files and serializes concurrent calls", async () => {
  let finish: (n: number) => void;
  mocks.exec
    .mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(0);
  const { cleanVideo } = await import("./clean-video");
  const first = cleanVideo(file),
    second = cleanVideo(file);
  await vi.waitFor(() => expect(mocks.exec).toHaveBeenCalledTimes(1));
  finish!(0);
  await Promise.all([first, second]);
  expect(mocks.instances).toHaveLength(1);
  const instance = mocks.instances[0] as {
    load: ReturnType<typeof vi.fn>;
    deleteFile: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
  };
  expect(instance.load).toHaveBeenCalledOnce();
  expect(instance.deleteFile).toHaveBeenCalledTimes(4);
  expect(mocks.exec).toHaveBeenCalledTimes(2);
  expect(instance.terminate).not.toHaveBeenCalled();
  vi.advanceTimersByTime(30000);
  expect(instance.terminate).toHaveBeenCalledOnce();
});
it("discards a failed encoder and processes the next queued file with a fresh one", async () => {
  mocks.exec.mockRejectedValueOnce(new Error("bad media")).mockResolvedValue(0);
  const { cleanVideo } = await import("./clean-video");
  await expect(cleanVideo(file)).rejects.toThrow("bad media");
  await expect(cleanVideo(file)).resolves.toHaveProperty("size", 3);
  expect(mocks.instances).toHaveLength(2);
});

it("falls back to compact encoding only if the fast output exceeds the upload limit", async () => {
  const { cleanVideo } = await import("./clean-video");
  await cleanVideo(file, undefined, 2);
  expect(mocks.exec).toHaveBeenCalledTimes(2);
  expect(mocks.exec.mock.calls[0][0]).toContain("ultrafast");
  expect(mocks.exec.mock.calls[1][0]).toContain("veryfast");
});
