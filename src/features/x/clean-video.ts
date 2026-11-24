import { FFmpeg } from "@ffmpeg/ffmpeg";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";
import {
  inspectFastRemuxMp4,
  videoCleanCommand,
  videoRemuxCommand,
} from "./video-command";

export type CleaningProgress = (
  stage: "loading" | "encoding" | "verifying",
  percent?: number,
) => void;

export const VIDEO_CLEAN_CONCURRENCY = 3;
const MAX_ENGINE_REUSES = 8;

const idleEngines: FFmpeg[] = [];
const engineUses = new WeakMap<FFmpeg, number>();
let activeCount = 0;
let nextRunId = 0;
const waiters: Array<(reused: FFmpeg | undefined) => void> = [];
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let cachedRuntimeUrls: Promise<{ coreURL: string; wasmURL: string }> | null = null;

async function fetchBlobUrl(url: string, mime: string): Promise<string> {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error("wasm_fetch_failed");
  const buffer = await response.arrayBuffer();
  return URL.createObjectURL(new Blob([buffer], { type: mime }));
}

// Fetch the 32 MB FFmpeg WASM core once into RAM blob: URLs so all 3 concurrent
// workers instantiate from memory instead of competing on 3 parallel downloads.
function getRuntimeUrls(): Promise<{ coreURL: string; wasmURL: string }> {
  if (
    typeof window === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    !/^https?:|^\//i.test(wasmURL) ||
    (typeof import.meta !== "undefined" && (import.meta as { env?: { MODE?: string } }).env?.MODE === "test")
  ) {
    return Promise.resolve({ coreURL, wasmURL });
  }
  if (!cachedRuntimeUrls) {
    cachedRuntimeUrls = Promise.all([
      fetchBlobUrl(coreURL, "text/javascript"),
      fetchBlobUrl(wasmURL, "application/wasm"),
    ])
      .then(([core, wasm]) => ({ coreURL: core, wasmURL: wasm }))
      .catch(() => {
        cachedRuntimeUrls = null;
        return { coreURL, wasmURL };
      });
  }
  return cachedRuntimeUrls;
}

/** Pre-fetches the FFmpeg WASM binary in the background before the user drops files. */
export function warmVideoCleaner(): void {
  void getRuntimeUrls();
}

function acquireEngine(): Promise<FFmpeg> {
  clearTimeout(idleTimer);
  if (activeCount < VIDEO_CLEAN_CONCURRENCY) {
    activeCount += 1;
    return Promise.resolve(idleEngines.pop() ?? new FFmpeg());
  }
  return new Promise<FFmpeg>((resolve) => {
    waiters.push((reused) => {
      resolve(reused ?? new FFmpeg());
    });
  });
}

function releaseEngine(healthy?: FFmpeg) {
  const next = waiters.shift();
  if (next) {
    next(healthy);
    return;
  }
  if (healthy) {
    idleEngines.push(healthy);
  }
  activeCount = Math.max(0, activeCount - 1);
  if (activeCount === 0 && idleEngines.length > 0) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (activeCount === 0) {
        while (idleEngines.length > 0) {
          idleEngines.pop()?.terminate();
        }
      }
    }, 30_000);
  }
}

export async function cleanVideoBytes(
  file: File,
  progress?: CleaningProgress,
  maxOutputBytes = Infinity,
): Promise<Uint8Array> {
  const ffmpeg = await acquireEngine();
  const runId = ++nextRunId;
  const inputPath = `in-${runId}.mp4`;
  const outputPath = `out-${runId}.mp4`;
  let healthy = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastProgress = 0;
  const notify = ({ progress: value }: { progress: number }) => {
    if (Date.now() - lastProgress < 250) return;
    lastProgress = Date.now();
    progress?.("encoding", Math.max(0, Math.min(99, Math.floor(value * 100))));
  };
  ffmpeg.on("progress", notify);
  try {
    const work = async (): Promise<Uint8Array> => {
      if (!ffmpeg.loaded) {
        progress?.("loading");
        const urls = await getRuntimeUrls();
        await ffmpeg.load(urls);
      }
      progress?.("encoding", 0);
      const input = new Uint8Array(await file.arrayBuffer());
      // IMPORTANT: Inspect MP4 headers BEFORE writeFile(), because @ffmpeg/ffmpeg
      // transfers and detaches input.buffer when posting it to the Web Worker.
      const remuxInfo = inspectFastRemuxMp4(input);
      await ffmpeg.writeFile(inputPath, input);

      // Fast path: stream-copy H.264 video (+ AAC audio when already mp4a) while
      // removing H.264 SEI NAL units and all MP4 container/track metadata.
      if (remuxInfo.canRemuxVideo) {
        const modes = remuxInfo.canCopyAudio ? [true, false] : [false];
        for (const copyAudio of modes) {
          let remuxed: Uint8Array | undefined;
          try {
            const exit = await ffmpeg.exec(
              videoRemuxCommand(inputPath, outputPath, copyAudio),
              180_000,
            );
            if (exit === 0) {
              const bytes = await ffmpeg.readFile(outputPath);
              if (typeof bytes !== "string") remuxed = bytes;
            }
          } catch {
            // Fall through to next remux mode or compatibility transcode.
          }
          if (remuxed?.byteLength && remuxed.byteLength <= maxOutputBytes) {
            return remuxed;
          }
          await Promise.allSettled([ffmpeg.deleteFile(outputPath)]);
          if (remuxed?.byteLength && remuxed.byteLength > maxOutputBytes) {
            break;
          }
        }
        progress?.("encoding", 0);
      }

      // Compatibility transcode when stream-copy is unsafe (e.g. HEVC, rotation, odd size).
      for (const preset of ["ultrafast", "veryfast"]) {
        const command = videoCleanCommand(inputPath, outputPath).map(
          (arg) => (arg === "ultrafast" ? preset : arg),
        );
        const exit = await ffmpeg.exec(command, 360_000);
        if (exit !== 0)
          throw new Error(
            "O vídeo não pôde ser decodificado ou excedeu o tempo de processamento. Confira se o MP4 está íntegro e tente um arquivo menor.",
          );
        const bytes = await ffmpeg.readFile(outputPath);
        if (typeof bytes === "string")
          throw new Error("Formato de vídeo inválido.");
        if (preset === "ultrafast" && bytes.byteLength > maxOutputBytes) {
          await ffmpeg.deleteFile(outputPath);
          progress?.("encoding", 0);
          continue;
        }
        return bytes;
      }
      throw new Error("Não foi possível preparar o vídeo.");
    };
    const result = await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "A limpeza demorou demais. Tente um vídeo menor ou confira sua conexão.",
              ),
            ),
          420_000,
        );
      }),
    ]);
    const uses = (engineUses.get(ffmpeg) ?? 0) + 1;
    engineUses.set(ffmpeg, uses);
    if (uses >= MAX_ENGINE_REUSES) {
      // Recycle worker periodically on large queues so monotonic WASM linear memory is freed.
      await Promise.allSettled([
        ffmpeg.deleteFile(inputPath),
        ffmpeg.deleteFile(outputPath),
      ]);
      healthy = false;
      ffmpeg.terminate();
    }
    return result;
  } catch (error) {
    healthy = false;
    ffmpeg.terminate();
    throw error;
  } finally {
    clearTimeout(timer);
    ffmpeg.off("progress", notify);
    if (healthy) {
      await Promise.allSettled([
        ffmpeg.deleteFile(inputPath),
        ffmpeg.deleteFile(outputPath),
      ]);
    }
    releaseEngine(healthy ? ffmpeg : undefined);
  }
}

export async function cleanVideo(
  file: File,
  progress?: CleaningProgress,
  maxOutputBytes = Infinity,
): Promise<Blob> {
  const bytes = await cleanVideoBytes(file, progress, maxOutputBytes);
  return new Blob([bytes], { type: "video/mp4" });
}
