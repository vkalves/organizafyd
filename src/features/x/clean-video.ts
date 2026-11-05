import { FFmpeg } from "@ffmpeg/ffmpeg";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";
import { videoCleanCommand } from "./video-command";
export type CleaningProgress = (
  stage: "loading" | "encoding" | "verifying",
  percent?: number,
) => void;
let engine: FFmpeg | undefined;
let queue: Promise<unknown> = Promise.resolve();
let idleTimer: ReturnType<typeof setTimeout> | undefined;

// A single reusable encoder prevents concurrent WASM heaps and recompilation per file.
// The library already runs FFmpeg in a Web Worker; release its memory after inactivity.
export function cleanVideo(
  file: File,
  progress?: CleaningProgress,
  maxOutputBytes = Infinity,
): Promise<Blob> {
  const task = queue.then(() => encode(file, progress, maxOutputBytes));
  queue = task.catch(() => undefined);
  return task;
}
async function encode(
  file: File,
  progress: CleaningProgress | undefined,
  maxOutputBytes: number,
): Promise<Blob> {
  clearTimeout(idleTimer);
  const ffmpeg = (engine ??= new FFmpeg());
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
      await ffmpeg.writeFile(
        "input.mp4",
        new Uint8Array(await file.arrayBuffer()),
      );
      // Prefer the fast encoder; retain the old compression as a bounded fallback
      // when a fast output would exceed the destination's existing file limit.
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
    ffmpeg.terminate();
    if (engine === ffmpeg) engine = undefined;
    throw error;
  } finally {
    clearTimeout(timer);
    ffmpeg.off("progress", notify);
    if (engine === ffmpeg) {
      await Promise.allSettled([
        ffmpeg.deleteFile("input.mp4"),
        ffmpeg.deleteFile("output.mp4"),
      ]);
      idleTimer = setTimeout(() => {
        if (engine === ffmpeg) {
          ffmpeg.terminate();
          engine = undefined;
        }
      }, 30_000);
    }
  }
}
