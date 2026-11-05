import { stripImageMetadata, stripVideoMetadata } from "./strip-metadata";
self.onmessage = async ({
  data,
}: MessageEvent<{ blob: Blob; outputType: string; image: boolean }>) => {
  try {
    let blob = data.blob;
    if (data.image) {
      const image = await createImageBitmap(blob, {
        imageOrientation: "from-image",
      });
      try {
        if (
          !image.width ||
          !image.height ||
          image.width * image.height > 40_000_000
        )
          throw new Error("Esta foto é grande demais. Use até 40 megapixels.");
        const canvas = new OffscreenCanvas(image.width, image.height);
        const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
        if (!ctx)
          throw new Error("Não foi possível preparar a foto neste navegador.");
        ctx.drawImage(image, 0, 0);
        blob = await canvas.convertToBlob({
          type: data.outputType,
          quality: 0.95,
        });
        canvas.width = 0;
        canvas.height = 0;
      } finally {
        image.close();
      }
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const verified = data.image
      ? stripImageMetadata(bytes, data.outputType)
      : stripVideoMetadata(bytes, { inPlace: true });
    self.postMessage({ blob: new Blob([verified], { type: data.outputType }) });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível verificar a mídia limpa. Nada foi enviado.",
    });
  }
};
