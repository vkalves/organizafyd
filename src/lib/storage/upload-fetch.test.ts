// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { withUploadTimeout } from "./upload-fetch";
afterEach(() => vi.useRealTimers());
it("aborts a stalled native Storage upload and allows the next file", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))).mockResolvedValueOnce(new Response("ok"));
  const uploadFetch = withUploadTimeout(fetcher, 1000);
  const pending = uploadFetch("https://example.supabase.co/storage/v1/object/media/file.mp4", { method: "POST" });
  const result = expect(pending).rejects.toThrow("O envio demorou demais");
  await vi.advanceTimersByTimeAsync(1001);
  await result;
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect((await uploadFetch("https://example.supabase.co/storage/v1/object/media/next.mp4", { method: "POST" })).ok).toBe(true);
});
it("preserves caller cancellation, Request bodies and request options", async () => {
  const cancel = new AbortController();
  const fetcher = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))));
  const request = new Request("https://example.supabase.co/storage/v1/object/media/file.mp4", { method: "POST", body: "video", signal: cancel.signal });
  const upload = withUploadTimeout(fetcher)(request, { headers: { authorization: "test" } });
  cancel.abort();
  await expect(upload).rejects.toMatchObject({ name: "AbortError" });
  expect(fetcher.mock.calls[0][0]).toBe(request);
  expect(fetcher.mock.calls[0][1].headers).toEqual({ authorization: "test" });
});
it("leaves auth, database, function calls and Storage reads unchanged", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("ok"));
  const boundedFetch = withUploadTimeout(fetcher);
  for (const [path, method] of [["auth/v1/token", "POST"], ["rest/v1/media", "POST"], ["functions/v1/publisher", "POST"], ["storage/v1/object/media/file.mp4", "GET"]]) {
    const options = { method, headers: { test: "unchanged" } };
    const url = `https://example.supabase.co/${path}`;
    await boundedFetch(url, options);
    expect(fetcher).toHaveBeenLastCalledWith(url, options);
  }
});
