export function processInWorker(
  blob: Blob,
  outputType: string,
  image: boolean,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./clean-media.worker.ts", import.meta.url),
      { type: "module" },
    );
    const timeout = setTimeout(
      () =>
        finish(new Error("A verificação demorou demais. Nada foi enviado.")),
      60_000,
    );
    function finish(error?: Error, result?: Blob) {
      clearTimeout(timeout);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    }
    worker.onmessage = ({
      data,
    }: MessageEvent<{ blob?: Blob; error?: string }>) => {
      if (data.error || !data.blob?.size)
        finish(
          new Error(
            data.error || "A limpeza gerou um arquivo vazio. Nada foi enviado.",
          ),
        );
      else finish(undefined, data.blob);
    };
    worker.onerror = () =>
      finish(
        new Error("Não foi possível iniciar a verificação. Nada foi enviado."),
      );
    worker.onmessageerror = () =>
      finish(
        new Error("Não foi possível ler a mídia limpa. Nada foi enviado."),
      );
    worker.postMessage({ blob, outputType, image });
  });
}
