const posters = new Map<string, string>();
const filePosters = new WeakMap<Blob, string>();
const filePosterListeners = new WeakMap<Blob, Set<(url: string) => void>>();

type Pending = { promise: Promise<string>; controller: AbortController; consumers: number };
const pending = new Map<string, Pending>();
const waiting: (() => void)[] = [];
let running = 0;
const MAX_CONCURRENT_POSTERS = 4;
const MAX_CACHED_POSTERS = 500;
const abortError = () => new DOMException("Preview cancelled", "AbortError");

export function cachedVideoPoster(key: string): string | undefined {
  return posters.get(key);
}

export function seedVideoPoster(key: string, dataUrl: string): void {
  if (!key || !dataUrl) return;
  posters.set(key, dataUrl);
  if (posters.size > MAX_CACHED_POSTERS) {
    posters.delete(posters.keys().next().value!);
  }
}

export function getFilePoster(file: Blob): string | undefined {
  return filePosters.get(file);
}

export function setFilePoster(file: Blob, dataUrl: string): void {
  if (!dataUrl) return;
  filePosters.set(file, dataUrl);
  const listeners = filePosterListeners.get(file);
  if (listeners) {
    for (const listener of listeners) {
      listener(dataUrl);
    }
  }
}

export function subscribeFilePoster(
  file: Blob,
  listener: (url: string) => void,
): () => void {
  const existing = filePosters.get(file);
  if (existing) {
    listener(existing);
  }
  let set = filePosterListeners.get(file);
  if (!set) {
    set = new Set();
    filePosterListeners.set(file, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
  };
}

function schedule(work: () => Promise<string>): Promise<string> {
  return new Promise((resolve, reject) => {
    waiting.push(() => {
      running++;
      void work().then(resolve, reject).finally(() => {
        running--;
        drain();
      });
    });
    drain();
  });
}

function drain() {
  while (running < MAX_CONCURRENT_POSTERS && waiting.length) {
    waiting.shift()!();
  }
}

/** Four bounded decoders, deduplication, and stable keys survive signed-URL refreshes. */
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
      seedVideoPoster(key, url);
      return url;
    });
    task = { promise, controller, consumers: 0 };
    pending.set(key, task);
    const current = task;
    void promise.then(
      () => {
        if (pending.get(key) === current) pending.delete(key);
      },
      () => {
        if (pending.get(key) === current) pending.delete(key);
      },
    );
  }
  const current = task;
  current.consumers++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const release = () => {
      signal?.removeEventListener("abort", abort);
      current.consumers--;
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      release();
      if (!current.consumers) current.controller.abort();
      reject(abortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    void current.promise.then(
      (url) => {
        if (!settled) {
          settled = true;
          release();
          resolve(url);
        }
      },
      (error) => {
        if (!settled) {
          settled = true;
          release();
          reject(error);
        }
      },
    );
  });
}

function extract(src: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    if (/^https?:/i.test(src)) {
      video.crossOrigin = "anonymous";
    }
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const timer = setTimeout(() => finish(new Error("Prévia indisponível")), 10_000);
    let seekFallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const abort = () => finish(new DOMException("Preview cancelled", "AbortError"));
    function captureFrame() {
      if (settled) return;
      try {
        if (!video.videoWidth || !video.videoHeight) {
          throw new Error("Prévia indisponível");
        }
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Prévia indisponível");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL("image/jpeg", 0.78);
        canvas.width = canvas.height = 0;
        finish(undefined, url);
      } catch {
        finish(new Error("Prévia indisponível"));
      }
    }
    function finish(error?: Error, url?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(seekFallbackTimer);
      signal?.removeEventListener("abort", abort);
      video.onloadedmetadata = video.onloadeddata = video.onseeked = video.onerror = null;
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* ignore in non-media test environments */
      }
      if (error) reject(error);
      else resolve(url!);
    }
    signal?.addEventListener("abort", abort, { once: true });
    video.onerror = () => finish(new Error("Prévia indisponível"));
    video.onloadeddata = () => {
      const target =
        Number.isFinite(video.duration) && video.duration > 0.2
          ? Math.min(0.15, video.duration / 2)
          : 0;
      if (target > 0.01) {
        seekFallbackTimer = setTimeout(captureFrame, 1200);
        try {
          video.currentTime = target;
        } catch {
          captureFrame();
        }
      } else {
        captureFrame();
      }
    };
    video.onseeked = captureFrame;
    video.src = src;
  });
}
