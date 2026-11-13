import { MAX_REEL_BYTES, parseReelUrl } from "./url.ts";

type Fetcher = typeof fetch;
const unavailable = () => new Error("reel_unavailable");
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

async function limitedText(response: Response, max: number): Promise<string> {
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > max) throw unavailable();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) throw unavailable();
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

export function validateMediaUrl(value: unknown): URL {
  if (typeof value !== "string") throw unavailable();
  let url: URL;
  try { url = new URL(value); } catch { throw unavailable(); }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["cdninstagram.com", "fbcdn.net"].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) throw unavailable();
  return url;
}

/** Public, logged-out Instagram response only: no account cookies or credentials. */
export async function downloadPublicReel(input: string, fetcher: Fetcher = fetch): Promise<ReadableStream<Uint8Array>> {
  const reel = parseReelUrl(input);
  const page = await fetcher(reel.url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  const html = await limitedText(page, 2 * 1024 * 1024);
  const lsd = html.match(/\["LSD",\[\],\{"token":"([a-zA-Z0-9_-]+)"/)?.[1];
  if (!lsd) throw unavailable();
  let id = 0n;
  for (const character of reel.shortcode) id = id * 64n + BigInt(alphabet.indexOf(character));
  // This is the same logged-out query used by Instagram's public Reel page.
  // If Instagram changes it or gates the response, fail without using private data.
  const query = await fetcher("https://www.instagram.com/api/graphql", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded", "X-IG-App-ID": "936619743392459",
      "X-FB-LSD": lsd, "X-FB-Friendly-Name": "PolarisLoggedOutDesktopWWWPostRootContentQuery",
      "X-Requested-With": "XMLHttpRequest", Origin: "https://www.instagram.com", Referer: reel.url,
    },
    body: new URLSearchParams({ lsd, fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: "PolarisLoggedOutDesktopWWWPostRootContentQuery", server_timestamps: "true",
      variables: JSON.stringify({ media_id: id.toString() }), doc_id: "27130156389949648" }),
  });
  const raw = await limitedText(query, 2 * 1024 * 1024);
  let mediaUrl: URL | undefined;
  for (const line of raw.split("\n")) {
    let result;
    try { result = JSON.parse(line); } catch { continue; }
    const media = result?.data?.xig_polaris_media;
    const product = media?.if_not_gated_logged_out;
    if (!product || product.user?.is_private === true || product.can_viewer_download === false ||
        (media.code && media.code !== reel.shortcode)) continue;
    const versions = product.video_versions;
    if (Array.isArray(versions) && versions.length) {
      mediaUrl = validateMediaUrl(versions[0]?.url);
      break;
    }
  }
  if (!mediaUrl) throw unavailable();
  for (let redirects = 0; redirects <= 2; redirects++) {
    const response = await fetcher(mediaUrl.href, { redirect: "manual", signal: AbortSignal.timeout(90_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw unavailable();
      mediaUrl = validateMediaUrl(new URL(location, mediaUrl).href);
      continue;
    }
    if (!response.ok || !response.body || !["video/mp4", "application/octet-stream"].includes((response.headers.get("content-type") || "").split(";")[0].trim())) {
      await response.body?.cancel(); throw unavailable();
    }
    if (Number(response.headers.get("content-length")) > MAX_REEL_BYTES) {
      await response.body.cancel(); throw new Error("reel_too_large");
    }
    let bytes = 0;
    return response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > MAX_REEL_BYTES) throw new Error("reel_too_large");
        controller.enqueue(chunk);
      },
    }));
  }
  throw unavailable();
}
