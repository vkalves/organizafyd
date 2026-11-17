/** Abort stalled Storage transfers without changing auth, database or function requests. */
export function withUploadTimeout(fetcher: typeof fetch, timeoutMs = 180_000): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "POST" || !url.includes("/storage/v1/object/")) return fetcher(input, init);
    const controller = new AbortController();
    const originalSignal = init?.signal || (input instanceof Request ? input.signal : undefined);
    const cancel = () => controller.abort(originalSignal?.reason);
    if (originalSignal?.aborted) cancel();
    else originalSignal?.addEventListener("abort", cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      return await fetcher(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (timedOut) throw new Error("O envio demorou demais. Confira a conexão e tente este arquivo novamente.");
      throw error;
    } finally {
      clearTimeout(timer);
      originalSignal?.removeEventListener("abort", cancel);
    }
  };
}
