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

it("cleans up to 3 videos concurrently, queues the 4th onto the first freed encoder, and releases idle workers", async () => {
  const resolvers: Array<(n: number) => void> = [];
  mocks.exec.mockImplementation(
    () =>
      new Promise<number>((resolve) => {
        resolvers.push(resolve);
      }),
  );

  const { cleanVideo } = await import("./clean-video");
  const v1 = cleanVideo(file);
  const v2 = cleanVideo(file);
  const v3 = cleanVideo(file);
  const v4 = cleanVideo(file);

  // Exactly 3 FFmpeg workers run simultaneously while the 4th waits in queue
  await vi.waitFor(() => expect(mocks.exec).toHaveBeenCalledTimes(3));
  expect(mocks.instances).toHaveLength(3);

  // Completing the 1st slot hands that warm FFmpeg instance directly to the 4th video
  resolvers[0](0);
  await vi.waitFor(() => expect(mocks.exec).toHaveBeenCalledTimes(4));
  expect(mocks.instances).toHaveLength(3);

  resolvers[1](0);
  resolvers[2](0);
  resolvers[3](0);
  await Promise.all([v1, v2, v3, v4]);

  const pool = mocks.instances as Array<{
    load: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
  }>;
  for (const inst of pool) {
    expect(inst.load).toHaveBeenCalledOnce();
    expect(inst.terminate).not.toHaveBeenCalled();
  }

  vi.advanceTimersByTime(30_000);
  for (const inst of pool) {
    expect(inst.terminate).toHaveBeenCalledOnce();
  }
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
