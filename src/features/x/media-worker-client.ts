const WORKER_POOL_SIZE = 3;

const idleWorkers: Worker[] = [];
let activeWorkers = 0;
const queue: Array<(worker: Worker | undefined) => void> = [];
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function createWorker() {
  return new Worker(new URL("./clean-media.worker.ts", import.meta.url), {
    type: "module",
  });
}

function acquireWorker(): Promise<Worker> {
  clearTimeout(idleTimer);
  if (activeWorkers < WORKER_POOL_SIZE) {
    activeWorkers += 1;
    return Promise.resolve(idleWorkers.pop() ?? createWorker());
  }
  return new Promise<Worker>((resolve) => {
    queue.push((reused) => resolve(reused ?? createWorker()));
  });
}

function releaseWorker(healthy?: Worker) {
  const next = queue.shift();
  if (next) {
    next(healthy);
    return;
  }
  if (healthy) {
    idleWorkers.push(healthy);
  }
  activeWorkers = Math.max(0, activeWorkers - 1);
  if (activeWorkers === 0 && idleWorkers.length > 0) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (activeWorkers === 0) {
        while (idleWorkers.length > 0) {
          idleWorkers.pop()?.terminate();
        }
      }
    }, 30_000);
  }
}

export async function processInWorker(
  blob: Blob,
  outputType: string,
  image: boolean,
): Promise<Blob> {
  const worker = await acquireWorker();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(
      () =>
        finish(
          new Error("A verificação demorou demais. Nada foi enviado."),
          undefined,
          false,
        ),
      60_000,
    );
    function finish(error?: Error, result?: Blob, reusable = true) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      if (!reusable) {
        worker.terminate();
        releaseWorker(undefined);
      } else {
        releaseWorker(worker);
      }
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
        undefined,
        false,
      );
    worker.onmessageerror = () =>
      finish(
        new Error("Não foi possível ler a mídia limpa. Nada foi enviado."),
        undefined,
        false,
      );
    worker.postMessage({ blob, outputType, image });
  });
}
