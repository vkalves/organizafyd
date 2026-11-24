import { FFmpeg } from "@ffmpeg/ffmpeg";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";
import {
  canFastRemuxH264,
  videoCleanCommand,
  videoRemuxCommand,
} from "./video-command";

export type CleaningProgress = (
  stage: "loading" | "encoding" | "verifying",
  percent?: number,
) => void;

export const VIDEO_CLEAN_CONCURRENCY = 3;

const idleEngines: FFmpeg[] = [];
let activeCount = 0;
const waiters: Array<(reused: FFmpeg | undefined) => void> = [];
let idleTimer: ReturnType<typeof setTimeout> | undefined;

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

// Up to 3 reusable FFmpeg workers clean metadata concurrently, queueing extra files
// onto whichever worker finishes first and releasing WASM memory after inactivity.
export async function cleanVideo(
  file: File,
  progress?: CleaningProgress,
  maxOutputBytes = Infinity,
): Promise<Blob> {
  const ffmpeg = await acquireEngine();
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
    const work = async () => {
      if (!ffmpeg.loaded) {
        progress?.("loading");
        await ffmpeg.load({ coreURL, wasmURL });
      }
      progress?.("encoding", 0);
      const input = new Uint8Array(await file.arrayBuffer());
      await ffmpeg.writeFile("input.mp4", input);
      // Copy common H.264 video without decoding it. MP4 container metadata and
      // H.264 SEI are still removed; all other inputs use the transcode below.
      if (canFastRemuxH264(input)) {
        let remuxed: Uint8Array | undefined;
        try {
          const exit = await ffmpeg.exec(
            videoRemuxCommand("input.mp4", "output.mp4"),
            180_000,
          );
          if (exit === 0) {
            const bytes = await ffmpeg.readFile("output.mp4");
            if (typeof bytes !== "string") remuxed = bytes;
          }
        } catch {
          // A remux failure falls through to the compatibility transcode.
        }
        if (remuxed?.byteLength && remuxed.byteLength <= maxOutputBytes)
          return new Blob([remuxed], { type: "video/mp4" });
        await Promise.allSettled([ffmpeg.deleteFile("output.mp4")]);
        progress?.("encoding", 0);
      }
      // Use the existing compatibility transcode when stream-copy is unsafe or
      // when the remuxed output exceeds the destination's size limit.
      for (const preset of ["ultrafast", "veryfast"]) {
        const command = videoCleanCommand("input.mp4", "output.mp4").map(
          (arg) => (arg === "ultrafast" ? preset : arg),
        );
        const exit = await ffmpeg.exec(command, 180_000);
        if (exit !== 0)
          throw new Error(
            "O vídeo não pôde ser decodificado ou excedeu o tempo de processamento. Confira se o MP4 está íntegro e tente um arquivo menor.",
          );
        const bytes = await ffmpeg.readFile("output.mp4");
        if (typeof bytes === "string")
          throw new Error("Formato de vídeo inválido.");
        if (preset === "ultrafast" && bytes.byteLength > maxOutputBytes) {
          await ffmpeg.deleteFile("output.mp4");
          progress?.("encoding", 0);
          continue;
        }
        return new Blob([bytes], { type: "video/mp4" });
      }
      throw new Error("Não foi possível preparar o vídeo.");
    };
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "A limpeza demorou demais. Tente um vídeo menor ou confira sua conexão.",
              ),
            ),
          240_000,
        );
      }),
    ]);
  } catch (error) {
    healthy = false;
    ffmpeg.terminate();
    throw error;
  } finally {
    clearTimeout(timer);
    ffmpeg.off("progress", notify);
    if (healthy) {
      await Promise.allSettled([
        ffmpeg.deleteFile("input.mp4"),
        ffmpeg.deleteFile("output.mp4"),
      ]);
    }
    releaseEngine(healthy ? ffmpeg : undefined);
  }
}
