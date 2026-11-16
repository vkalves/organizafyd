// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { campaignMediaUrl, verifyMediaUrl } from "../../../supabase/functions/instagram-media/token";
import { cleanMp4Stream, rangeStream, byteRange, MAX_MEDIA_BYTES } from "../../../supabase/functions/instagram-media/clean-stream";
import { mediaHandler } from "../../../supabase/functions/instagram-media/handler";
import { stripVideoMetadata } from "../x/strip-metadata";

const secret = "test-only-secret", owner = "11111111-1111-4111-8111-111111111111";
const job = "22222222-2222-4222-8222-222222222222", nextJob = "33333333-3333-4333-8333-333333333333";
const path = `${owner}/video.mp4`, base = "https://example.supabase.co";
const text = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => new Uint8Array(parts.flatMap(p => [...p]));
const box = (type: string, body = new Uint8Array()) => {
  const bytes = new Uint8Array(body.length + 8);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  bytes.set(text(type), 4); bytes.set(body, 8); return bytes;
};
const movie = box("moov", concat(box("udta", text("PRIVATE GPS")), box("trak", box("mdia", box("hdlr", concat(new Uint8Array(24), text("PRIVATE TRACK")))))));
const video = concat(box("ftyp", text("isom")), box("uuid", text("PRIVATE ID")), box("mdat", text("VIDEO AUDIO")), movie);
function stream(bytes: Uint8Array, step = 3, cancelled = () => {}) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) controller.close();
      else { controller.enqueue(bytes.slice(offset, offset + step)); offset = Math.min(offset + step, bytes.length); }
    },
    cancel: cancelled,
  });
}
const collect = async (body: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(body).arrayBuffer());

describe("per-publication media capabilities", () => {
  it("issues different URLs for the same file in consecutive hourly publications", async () => {
    const now = Date.now();
    const first = await campaignMediaUrl(`storage://${path}`, job, base, secret, now);
    const second = await campaignMediaUrl(`storage://${path}`, nextJob, base, secret, now + 3600_000);
    expect(first).not.toBe(second);
    expect(first).not.toContain(secret);
    expect(await verifyMediaUrl(new URL(first), secret, now)).toBe(path);
    expect(await verifyMediaUrl(new URL(second), secret, now + 3600_000)).toBe(path);
    await expect(verifyMediaUrl(new URL(first), secret, now + 3600_000)).rejects.toThrow();
  });
  it.each(["path", "job", "expires", "signature"])("rejects tampered %s", async field => {
    const url = new URL(await campaignMediaUrl(`storage://${path}`, job, base, secret));
    url.searchParams.set(field, field === "path" ? `${owner}/other.mp4` : field === "job" ? nextJob : field === "expires" ? String(Math.floor(Date.now() / 1000) + 1800) : "0".repeat(64));
    await expect(verifyMediaUrl(url, secret)).rejects.toThrow();
  });
  it.each(["https://internal.example/a.mp4", `storage://${owner}/../other.mp4`, `storage://${owner}//video.mp4`])("refuses unsafe source %s", async value => {
    await expect(campaignMediaUrl(value, job, base, secret)).rejects.toThrow();
  });
});

describe("streaming metadata cleaning", () => {
  it.each([1, 3, 32, 1024])("cleans split headers and tail moov with %i byte chunks, preserving samples and offsets", async step => {
    const cleaned = await collect(cleanMp4Stream(stream(video, step), video.length));
    expect(cleaned).toEqual(stripVideoMetadata(video));
    expect(cleaned.length).toBe(video.length);
    expect(new TextDecoder().decode(cleaned)).not.toContain("PRIVATE");
    expect(new TextDecoder().decode(cleaned)).toContain("VIDEO AUDIO");
  });
  it("handles extended and zero-length MP4 boxes", async () => {
    const head = new Uint8Array(16); new DataView(head.buffer).setUint32(0, 1); head.set(text("uuid"), 4); new DataView(head.buffer).setBigUint64(8, 24n);
    const tail = box("mdat", text("VIDEO")); new DataView(tail.buffer).setUint32(0, 0);
    const input = concat(box("ftyp"), head, text("PRIVATE!"), movie, tail);
    expect(await collect(cleanMp4Stream(stream(input), input.length))).toEqual(stripVideoMetadata(input));
  });
  it.each([video.slice(0, -1), concat(box("ftyp"), box("mdat")), concat(box("ftyp"), box("moof")), concat(box("ftyp"), new Uint8Array([255,255,255,255,109,111,111,118]))])("fails closed for malformed media", async input => {
    await expect(collect(cleanMp4Stream(stream(input), Math.max(24, input.length)))).rejects.toThrow();
  });
  it("rejects oversized input before buffering", () => {
    expect(() => cleanMp4Stream(stream(video), MAX_MEDIA_BYTES + 1)).toThrow();
  });
  it("cancels the upstream even before the first read", async () => {
    const cancelled = vi.fn();
    await cleanMp4Stream(stream(video, 3, cancelled), video.length).cancel();
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it("applies byte ranges to the cleaned representation", async () => {
    const expected = stripVideoMetadata(video), range = { start: 12, end: video.length - 9 };
    expect(await collect(rangeStream(cleanMp4Stream(stream(video), video.length), range))).toEqual(expected.slice(range.start, range.end + 1));
    expect(byteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(() => byteRange("bytes=100-", 100)).toThrow();
    expect(() => byteRange("bytes=1-2,4-5", 100)).toThrow();
  });
});

describe("Meta media download", () => {
  async function setup(file = video, filePath = path) {
    const sign = vi.fn(async () => "https://storage.example/private");
    const request = vi.fn(async () => new Response(stream(file), { headers: { "content-length": String(file.length) } }));
    const handler = mediaHandler(secret, sign, request as typeof fetch);
    const url = await campaignMediaUrl(`storage://${filePath}`, job, base, secret);
    return { handler, url, request, sign };
  }
  it("cleans again on every download, including repeated downloads of the same job", async () => {
    const { handler, url, request } = await setup();
    for (let i = 0; i < 2; i++) {
      const response = await handler(new Request(url));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(stripVideoMetadata(video));
    }
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("cleans JPEG EXIF and comments before serving a cover, including ranges", async () => {
    const jpeg = concat(new Uint8Array([255,216,255,225,0,9]), text("PRIVATE"), new Uint8Array([255,218,0,2,10,20,255,217]));
    const { handler, url } = await setup(jpeg, `${owner}/cover.jpg`);
    const response = await handler(new Request(url));
    const cleaned = new Uint8Array(await response.arrayBuffer());
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(new TextDecoder().decode(cleaned)).not.toContain("PRIVATE");
    expect(Number(response.headers.get("content-length"))).toBe(cleaned.length);
    const partial = await handler(new Request(url, { headers: { range: "bytes=-4" } }));
    expect(partial.status).toBe(206);
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(cleaned.slice(-4));
  });
  it("serves cleaned MP4 ranges and HEAD without redirecting to the source", async () => {
    const { handler, url } = await setup();
    const response = await handler(new Request(url, { headers: { range: "bytes=12-40" } }));
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 12-40/${video.length}`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(stripVideoMetadata(video).slice(12, 41));
    const head = await handler(new Request(url, { method: "HEAD" }));
    expect(head.status).toBe(200); expect(await head.text()).toBe("");
    expect((await handler(new Request(url, { headers: { range: "bytes=9999-" } }))).status).toBe(416);
  });
  it("blocks unauthenticated requests before signing or fetching any file", async () => {
    const { handler, url, sign, request } = await setup();
    const invalid = new URL(url); invalid.searchParams.delete("signature");
    expect((await handler(new Request(invalid))).status).toBe(403);
    expect(sign).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  });
  it("does not fall back to the original when cleaning or download fails", async () => {
    const { handler, url } = await setup(text("invalid jpeg"), `${owner}/cover.jpg`);
    const response = await handler(new Request(url));
    expect(response.status).toBe(502); expect(response.headers.has("location")).toBe(false);
    const unavailable = mediaHandler(secret, async () => "https://storage.example/private", vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch);
    expect((await unavailable(new Request(url))).status).toBe(502);
  });
});
