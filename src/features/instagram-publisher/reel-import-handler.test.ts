// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createReelImportHandler } from "../../../supabase/functions/instagram-reel-import/handler";
import { downloadPublicReel, validateMediaUrl } from "../../../supabase/functions/instagram-reel-import/download";
import { MAX_REEL_BYTES, parseReelUrl } from "../../../supabase/functions/instagram-reel-import/url";

const reel = "https://www.instagram.com/reel/DY2PcmxiBE2/";
const request = (url = reel, token = "Bearer fixture") => new Request("https://example.test", { method: "POST", headers: { authorization: token, "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
function upstream(options: { private?: boolean; url?: string; size?: number; redirect?: string; gated?: boolean } = {}) {
  return vi.fn<typeof fetch>(async input => {
    const url = String(input);
    if (url === reel) return new Response('["LSD",[],{"token":"public-session"}]');
    if (url === "https://www.instagram.com/api/graphql") return Response.json({ data: { xig_polaris_media: {
      code: "DY2PcmxiBE2", if_not_gated_logged_out: options.gated ? null : { user: { is_private: options.private === true }, video_versions: [{ url: options.url ?? "https://scontent.cdninstagram.com/video.mp4" }] },
    } } });
    if (options.redirect) return new Response(null, { status: 302, headers: { location: options.redirect } });
    return new Response(new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 1, 2, 3, 4]), { headers: { "Content-Type": "video/mp4", ...(options.size ? { "Content-Length": String(options.size) } : {}) } });
  });
}
describe("public Reel import boundary", () => {
  it("normalizes copied Reel links and rejects other sites, credentials and unsupported paths", () => {
    expect(parseReelUrl("https://www.instagram.com/creator/reel/DY2PcmxiBE2/?igsh=tracking").url).toBe(reel);
    for (const value of ["http://www.instagram.com/reel/abcdef/", "https://instagram.com.attacker.test/reel/abcdef/", "https://user:pass@instagram.com/reel/abcdef/", "https://instagram.com:444/reel/abcdef/", "https://instagram.com/creator/", "https://127.0.0.1/reel/abcdef/", null]) expect(() => parseReelUrl(value)).toThrow("invalid_reel_url");
  });
  it("authenticates before contacting Instagram and validates the link before downloading", async () => {
    const auth = vi.fn().mockResolvedValue(false), download = vi.fn();
    const handler = createReelImportHandler(auth, download);
    expect((await handler(request(reel, ""))).status).toBe(401);
    expect(auth).not.toHaveBeenCalled();
    expect((await handler(request())).status).toBe(401); expect(download).not.toHaveBeenCalled();
    auth.mockResolvedValue(true);
    expect((await handler(request("https://attacker.test/file.mp4"))).status).toBe(400); expect(download).not.toHaveBeenCalled();
  });
  it("streams a public Reel as MP4 with no cache or upstream credentials", async () => {
    const fetcher = upstream();
    const handler = createReelImportHandler(async () => true, url => downloadPublicReel(url, fetcher));
    const response = await handler(request());
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("cache-control")).toBe("no-store"); expect((await response.arrayBuffer()).byteLength).toBe(12);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.every(([, init]) => !new Headers(init?.headers).has("authorization") && !new Headers(init?.headers).has("cookie"))).toBe(true);
  });
  it("does not download private/gated content or accept arbitrary media hosts and redirects", async () => {
    for (const options of [{ private: true }, { gated: true }, { url: "https://127.0.0.1/private" }, { url: "https://scontent.cdninstagram.com.attacker.test/file" }, { redirect: "http://169.254.169.254/latest/meta-data/" }]) {
      await expect(downloadPublicReel(reel, upstream(options))).rejects.toThrow("reel_unavailable");
    }
    expect(() => validateMediaUrl("https://secret@video.fbcdn.net/file")).toThrow();
  });
  it("rejects oversized downloads before responding with a video", async () => {
    const handler = createReelImportHandler(async () => true, url => downloadPublicReel(url, upstream({ size: MAX_REEL_BYTES + 1 })));
    const response = await handler(request()); expect(response.status).toBe(413); expect(await response.json()).toEqual({ error: "reel_too_large" });
  });
});
