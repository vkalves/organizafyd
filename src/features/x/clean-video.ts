import { FFmpeg } from "@ffmpeg/ffmpeg";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";
import { videoCleanCommand } from "./video-command";
// Single-thread core needs no cross-origin isolation headers. Assets are served
// by our own site, and the media stays on the user's device during cleaning.
export async function cleanVideo(file: File): Promise<Blob> {
  const ffmpeg = new FFmpeg();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = async () => {
      await ffmpeg.load({ coreURL, wasmURL });
      await ffmpeg.writeFile(
        "input.mp4",
        new Uint8Array(await file.arrayBuffer()),
      );
      const exit = await ffmpeg.exec(
        videoCleanCommand("input.mp4", "output.mp4"),
        180_000,
      );
      if (exit !== 0)
        throw new Error(
          "O vídeo não pôde ser processado em até 3 minutos. Tente um vídeo menor.",
        );
      const bytes = await ffmpeg.readFile("output.mp4");
      if (typeof bytes === "string")
        throw new Error("Formato de vídeo inválido.");
      return new Blob([new Uint8Array(bytes)], { type: "video/mp4" });
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
  } finally {
    clearTimeout(timer);
    ffmpeg.terminate();
  }
}
