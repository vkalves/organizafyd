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

it("stream-copies both H.264 video and mp4a audio on standard MP4 Reels without software re-encoding", async () => {
  const text = (s: string) => new TextEncoder().encode(s);
  const u32 = (n: number) => new Uint8Array([n >>> 24, n >>> 16, n >>> 8, n]);
  const u16 = (n: number) => new Uint8Array([n >>> 8, n & 0xff]);
  const concat = (...parts: Uint8Array[]) =>
    new Uint8Array(parts.flatMap((p) => [...p]));
  const box = (type: string, body = new Uint8Array()) =>
    concat(u32(body.length + 8), text(type), body);

  // Build valid tkhd with identity matrix
  const tkhdBody = new Uint8Array(84);
  const tkhdView = new DataView(tkhdBody.buffer);
  [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824].forEach((v, i) =>
    tkhdView.setUint32(40 + i * 4, v),
  );

  // Valid Baseline Profile (66) SPS NAL + avcC + avc3 entry (1080x1920)
  const sps = new Uint8Array([0x67, 66, 0x00, 0x1f, 0xe9]);
  const avcC = box(
    "avcC",
    concat(new Uint8Array([1, 66, 0, 31, 0xff, 0xe1]), u16(sps.length), sps),
  );
  const visualHeader = new Uint8Array(78);
  const vhView = new DataView(visualHeader.buffer);
  vhView.setUint16(24, 1080);
  vhView.setUint16(26, 1920);
  const videoStsd = box(
    "stsd",
    concat(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]), box("avc3", concat(visualHeader, avcC))),
  );
  const videoHdlr = box("hdlr", concat(new Uint8Array(8), text("vide")));
  const videoTrak = box(
    "trak",
    concat(box("tkhd", tkhdBody), box("mdia", concat(videoHdlr, box("minf", box("stbl", videoStsd))))),
  );

  // Valid mp4a audio track
  const audioStsd = box(
    "stsd",
    concat(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]), box("mp4a", new Uint8Array(28))),
  );
  const audioHdlr = box("hdlr", concat(new Uint8Array(8), text("soun")));
  const audioTrak = box(
    "trak",
    concat(box("mdia", concat(audioHdlr, box("minf", box("stbl", audioStsd))))),
  );

  const mp4Bytes = concat(
    box("ftyp", text("isom")),
    box("moov", concat(videoTrak, audioTrak)),
    box("mdat", text("H264+AAC")),
    new Uint8Array([0, 0, 0, 0]), // trailing zero padding
  );
  const mp4File = { arrayBuffer: async () => mp4Bytes.buffer } as File;

  const { cleanVideo } = await import("./clean-video");
  await cleanVideo(mp4File);

  expect(mocks.exec).toHaveBeenCalledOnce();
  const args = mocks.exec.mock.calls[0][0] as string[];
  expect(args).toContain("-c:v");
  expect(args[args.indexOf("-c:v") + 1]).toBe("copy");
  expect(args).toContain("-c:a");
  expect(args[args.indexOf("-c:a") + 1]).toBe("copy");
  expect(args).toContain("filter_units=remove_types=6");
});

