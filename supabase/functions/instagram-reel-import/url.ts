export const MAX_REEL_BYTES = 100 * 1024 * 1024;
export function parseReelUrl(value: unknown): { url: string; shortcode: string } {
  if (typeof value !== "string" || value.length > 2048) throw new Error("invalid_reel_url");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("invalid_reel_url"); }
  const match = url.pathname.match(/^\/(?:[a-zA-Z0-9._]+\/)?reels?\/([a-zA-Z0-9_-]{5,30})\/?$/);
  if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com", "m.instagram.com"].includes(url.hostname) || url.username || url.password || url.port || !match) throw new Error("invalid_reel_url");
  return { url: `https://www.instagram.com/reel/${match[1]}/`, shortcode: match[1] };
}
