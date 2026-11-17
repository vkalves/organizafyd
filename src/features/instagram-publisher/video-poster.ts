const posters = new Map<string, string>();
let tail: Promise<unknown> = Promise.resolve();
/** Decode one small poster at a time. Leaving the viewport cancels pending work. */
export function videoPoster(src: string, signal?: AbortSignal): Promise<string> {
  const task = tail.then(async () => {
    if (signal?.aborted) throw new DOMException("Preview cancelled", "AbortError");
    const cached = posters.get(src);
    if (cached) return cached;
    const url = await extract(src, signal);
    posters.set(src, url);
    // Data URLs remain valid for mounted images after cache eviction.
    if (posters.size > 100) posters.delete(posters.keys().next().value!);
    return url;
  });
  tail = task.catch(() => undefined);
  return task;
}
function extract(src: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    const timer = setTimeout(() => finish(new Error("Prévia indisponível")), 12_000);
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
        const scale = Math.min(1, 360 / Math.max(video.videoWidth, video.videoHeight));
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
