import { stripImageMetadata, stripVideoMetadata } from "./strip-metadata";
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
          file.type,
          0.95,
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
export async function cleanMedia(file: File, options?: { maxBytes: number; jpeg?: boolean }): Promise<File> {
  if (options) {
    if (!["image/jpeg", "image/png", "video/mp4"].includes(file.type) || !file.size || file.size > options.maxBytes)
      throw new Error(`Use JPG, PNG ou MP4 de até ${options.maxBytes / 1024 / 1024} MB.`);
  } else validateFile(file);
  // Instagram accepts JPEG photos; decoding also applies EXIF orientation.
  const outputType = options?.jpeg && file.type.startsWith('image/') ? 'image/jpeg' : file.type;
  const source = outputType === file.type ? file : new File([file], file.name, { type: outputType });
  let blob: Blob;
  try {
    blob =
      file.type === "video/mp4"
        ? await (await import("./clean-video")).cleanVideo(file)
        : await cleanImage(file, outputType);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const verified = file.type === "video/mp4"
      ? stripVideoMetadata(bytes)
      : stripImageMetadata(bytes, outputType);
    blob = new Blob([verified], { type: outputType });
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
  if (
    clean.size > (options?.maxBytes ?? (file.type === "video/mp4" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES))
  ) {
    throw new Error(
      `Após a limpeza, o arquivo ultrapassou ${options ? options.maxBytes / 1024 / 1024 : file.type === "video/mp4" ? 20 : 5} MB. Reduza o tamanho e envie novamente.`,
    );
  }
  if (!clean.size)
    throw new Error("A limpeza gerou um arquivo vazio. Nada foi enviado.");
  return clean;
}
