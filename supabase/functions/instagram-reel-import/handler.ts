import { downloadPublicReel } from "./download.ts";
import { parseReelUrl } from "./url.ts";

const origins = new Set(["https://www.organizafy.site", "https://organizafy.site", "https://xn--avana-1ra.online", "https://www.xn--avana-1ra.online", "https://organizafyd.vercel.app"]);
export function createReelImportHandler(authenticate: (token: string) => Promise<boolean>, download = downloadPublicReel) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin") || "";
    const headers = {
      "Access-Control-Allow-Origin": origins.has(origin) ? origin : "https://www.organizafy.site",
      "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
      "Access-Control-Allow-Methods": "POST,OPTIONS", "Cache-Control": "no-store", Vary: "Origin",
    };
    const error = (code: string, status: number) => new Response(JSON.stringify({ error: code }), { status, headers: { ...headers, "Content-Type": "application/json" } });
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method !== "POST") return error("method_not_allowed", 405);
    try {
      const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
      if (!token || !await authenticate(token)) return error("unauthorized", 401);
      if (Number(request.headers.get("content-length")) > 4096) return error("invalid_reel_url", 400);
      const text = await request.text();
      if (text.length > 4096) return error("invalid_reel_url", 400);
      const body = JSON.parse(text);
      const reel = parseReelUrl(body?.url);
      const video = await download(reel.url);
      // FunctionsClient decodes octet-stream as Blob; video/mp4 would be decoded as text.
      return new Response(video, { headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="reel-${reel.shortcode}.mp4"`, "X-Content-Type-Options": "nosniff" } });
    } catch (cause) {
      if (cause instanceof SyntaxError || (cause instanceof Error && cause.message === "invalid_reel_url")) return error("invalid_reel_url", 400);
      if (cause instanceof Error && cause.message === "reel_too_large") return error("reel_too_large", 413);
      return error("reel_unavailable", 502);
    }
  };
}
