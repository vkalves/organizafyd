const posters = new Map<string, string>();
type Pending = { promise: Promise<string>; controller: AbortController; consumers: number };
const pending = new Map<string, Pending>();
const waiting: (() => void)[] = [];
let running = 0;
const abortError = () => new DOMException("Preview cancelled", "AbortError");
export function cachedVideoPoster(key: string): string | undefined { return posters.get(key); }
function schedule(work: () => Promise<string>): Promise<string> {
  return new Promise((resolve, reject) => {
    waiting.push(() => {
      running++;
      void work().then(resolve, reject).finally(() => { running--; drain(); });
    });
    drain();
  });
}
function drain() {
  while (running < 2 && waiting.length) waiting.shift()!();
}
/** Two bounded decoders, deduplication, and stable keys survive signed-URL refreshes. */
export function videoPoster(src: string, signal?: AbortSignal, key = src): Promise<string> {
  if (signal?.aborted) return Promise.reject(abortError());
  const cached = posters.get(key);
  if (cached) return Promise.resolve(cached);
  let task = pending.get(key);
  if (!task || task.controller.signal.aborted) {
    const controller = new AbortController();
    const promise = schedule(async () => {
      if (controller.signal.aborted) throw abortError();
      const url = await extract(src, controller.signal);
      posters.set(key, url);
      if (posters.size > 100) posters.delete(posters.keys().next().value!);
      return url;
    });
    task = { promise, controller, consumers: 0 };
    pending.set(key, task);
    const current = task;
    void promise.then(() => { if (pending.get(key) === current) pending.delete(key); }, () => { if (pending.get(key) === current) pending.delete(key); });
  }
  const current = task;
  current.consumers++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const release = () => { signal?.removeEventListener("abort", abort); current.consumers--; };
    const abort = () => {
      if (settled) return;
      settled = true; release();
      if (!current.consumers) current.controller.abort();
      reject(abortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    void current.promise.then(url => { if (!settled) { settled = true; release(); resolve(url); } }, error => { if (!settled) { settled = true; release(); reject(error); } });
  });
}
function extract(src: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    const timer = setTimeout(() => finish(new Error("Prévia indisponível")), 8_000);
    let settled = false;
    const abort = () => finish(new DOMException("Preview cancelled", "AbortError"));
    function finish(error?: Error, url?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      video.onloadedmetadata = video.onseeked = video.onerror = null;
      video.removeAttribute("src"); video.load();
      if (error) reject(error); else resolve(url!);
    }
    signal?.addEventListener("abort", abort, { once: true });
    video.onerror = () => finish(new Error("Prévia indisponível"));
    video.onloadedmetadata = () => { video.currentTime = Math.min(0.1, video.duration / 2) || 0; };
    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Prévia indisponível");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL("image/jpeg", 0.75);
        canvas.width = canvas.height = 0;
        finish(undefined, url);
      } catch { finish(new Error("Prévia indisponível")); }
    };
    video.src = src;
  });
}
