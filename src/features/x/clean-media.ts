import { processInWorker } from "./media-worker-client";
import type { CleaningProgress } from "./clean-video";
import { stripImageMetadata, stripVideoMetadata } from "./strip-metadata";
import {
  getFilePoster,
  setFilePoster,
} from "@/features/instagram-publisher/video-poster";
/** Reconstruct media before upload. Originals never enter Storage. */
export type MediaStage = "cleaning" | "uploading";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
export function validateFile(file: File) {
  if (
    !["image/jpeg", "image/png", "video/mp4"].includes(file.type) ||
    !file.size ||
    file.size > (file.type === "video/mp4" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)
  ) {
    throw new Error(
      "Use fotos JPG/PNG de até 5 MB ou vídeos MP4 de até 20 MB.",
    );
  }
}
async function cleanImage(file: File, outputType = file.type): Promise<Blob> {
  const image = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    if (
      !image.width ||
      !image.height ||
      image.width * image.height > 40_000_000
    ) {
      throw new Error(
        "Esta foto é grande demais para limpar neste dispositivo. Use até 40 megapixels.",
      );
    }
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
    if (!ctx)
      throw new Error("Não foi possível preparar a foto neste navegador.");
    ctx.drawImage(image, 0, 0);
    try {
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(new Error("Não foi possível limpar a foto.")),
          outputType,
          0.9,
        ),
      );
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    image.close();
  }
}
function resolveMediaType(file: File): string {
  const raw = (file.type || "").toLowerCase();
  if (raw === "image/jpeg" || raw === "image/jpg") return "image/jpeg";
  if (raw === "image/png") return "image/png";
  if (
    raw === "video/mp4" ||
    raw === "video/quicktime" ||
    raw === "video/x-m4v" ||
    raw === "application/mp4"
  ) {
    return "video/mp4";
  }
  if (!raw && file.name) {
    if (/\.jpe?g$/i.test(file.name)) return "image/jpeg";
    if (/\.png$/i.test(file.name)) return "image/png";
    if (/\.(mp4|mov|m4v)$/i.test(file.name)) return "video/mp4";
  }
  return raw;
}

export async function cleanMedia(
  file: File,
  options?: { maxBytes: number; jpeg?: boolean; onProgress?: CleaningProgress },
): Promise<File> {
  const mediaType = options ? resolveMediaType(file) : file.type;
  if (options) {
    if (
      !["image/jpeg", "image/png", "video/mp4"].includes(mediaType) ||
      !file.size ||
      file.size > options.maxBytes
    )
      throw new Error(
        `Use JPG, PNG ou MP4 de até ${options.maxBytes / 1024 / 1024} MB.`,
      );
  } else validateFile(file);
  // Instagram accepts JPEG photos; decoding also applies EXIF orientation.
  const outputType =
    options?.jpeg && mediaType.startsWith("image/") ? "image/jpeg" : mediaType;
  let blob: Blob;
  try {
    const video = mediaType === "video/mp4";
    const workerAvailable = typeof Worker !== "undefined";
    if (video) {
      const videoCleaner = await import("./clean-video");
      const rawBytes = videoCleaner.cleanVideoBytes
        ? await videoCleaner.cleanVideoBytes(
            file,
            options?.onProgress,
            options?.maxBytes ?? MAX_VIDEO_BYTES,
            (posterUrl) => setFilePoster(file, posterUrl),
          )
        : new Uint8Array(
            await (
              await videoCleaner.cleanVideo(
                file,
                options?.onProgress,
                options?.maxBytes ?? MAX_VIDEO_BYTES,
              )
            ).arrayBuffer(),
          );
      options?.onProgress?.("verifying");
      // stripVideoMetadata walks only MP4 box headers (<0.1ms in-place) — avoid
      // cloning the entire video buffer across extra Blob/Worker boundaries.
      blob = new Blob(
        [stripVideoMetadata(rawBytes, { inPlace: true })],
        { type: outputType },
      );
    } else if (workerAvailable && typeof OffscreenCanvas !== "undefined") {
      options?.onProgress?.("verifying");
      blob = await processInWorker(file, outputType, true);
    } else {
      blob = await cleanImage(file, outputType);
      blob = new Blob(
        [
          stripImageMetadata(
            new Uint8Array(await blob.arrayBuffer()),
            outputType,
          ),
        ],
        { type: outputType },
      );
    }
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Limpeza não concluída: ${error.message}`
        : "Não foi possível limpar o arquivo. Ele não foi enviado.",
    );
  }
  const ext =
    outputType === "video/mp4"
      ? "mp4"
      : outputType === "image/png"
        ? "png"
        : "jpg";
  // Neutral filename and date: avoid copying identifying information into post records.
  const clean = new File([blob], `midia-${crypto.randomUUID()}.${ext}`, {
    type: outputType,
    lastModified: 0,
  });
  const extractedPoster = getFilePoster(file);
  if (extractedPoster) {
    setFilePoster(clean, extractedPoster);
  }
  if (
    clean.size >
    (options?.maxBytes ??
      (file.type === "video/mp4" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES))
  ) {
    throw new Error(
      `Após a limpeza, o arquivo ultrapassou ${options ? options.maxBytes / 1024 / 1024 : file.type === "video/mp4" ? 20 : 5} MB. Reduza o tamanho e envie novamente.`,
    );
  }
  if (!clean.size)
    throw new Error("A limpeza gerou um arquivo vazio. Nada foi enviado.");
  return clean;
}
