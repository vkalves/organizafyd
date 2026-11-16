import { byteRange, cleanMp4Stream, cleanPhoto, MAX_MEDIA_BYTES, rangeStream } from "./clean-stream.ts";
import { verifyMediaUrl } from "./token.ts";

export function mediaHandler(secret: string, signSource: (path: string) => Promise<string>, request: typeof fetch = fetch) {
  return async (req: Request): Promise<Response> => {
    const headers = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405, headers });
    let path: string;
    try { path = await verifyMediaUrl(new URL(req.url), secret); }
    catch { return new Response(null, { status: 403, headers }); }
    let upstream: Response | undefined;
    try {
      // No user-supplied URL or forwarded Range header reaches the source.
      upstream = await request(await signSource(path), { signal: AbortSignal.timeout(120_000) });
      if (!upstream.ok || !upstream.body) throw new Error("media_unavailable");
      const length = Number(upstream.headers.get("content-length"));
      if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_MEDIA_BYTES) throw new Error("invalid_media_size");
      const video = /\.mp4$/i.test(path);
      let body: ReadableStream<Uint8Array>, outputLength = length;
      if (video) body = cleanMp4Stream(upstream.body, length);
      else {
        const photo = await cleanPhoto(upstream.body, length);
        outputLength = photo.length;
        body = new ReadableStream({ start(controller) { controller.enqueue(photo); controller.close(); } });
      }
      headers.set("Content-Type", video ? "video/mp4" : "image/jpeg");
      headers.set("Accept-Ranges", "bytes");
      let range;
      try { range = byteRange(req.headers.get("range"), outputLength); }
      catch {
        await body.cancel();
        headers.set("Content-Range", `bytes */${outputLength}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set("Content-Length", String(range ? range.end - range.start + 1 : outputLength));
      if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${outputLength}`);
      if (req.method === "HEAD") { await body.cancel(); return new Response(null, { status: range ? 206 : 200, headers }); }
      return new Response(range ? rangeStream(body, range) : body, { status: range ? 206 : 200, headers });
    } catch {
      await upstream?.body?.cancel().catch(() => {});
      // Never redirect to the original if cleaning fails.
      return new Response(null, { status: 502, headers });
    }
  };
}
