export type Format = "Feed" | "Reel" | "Story" | "Carrossel";
export type Draft = {
  id: string;
  account_id: string;
  caption: string;
  format: Format;
  media_urls: string[];
  scheduled_at: string | null;
};
export function validate(d: Draft, userId: string, now = Date.now()) {
  if (!/^[0-9a-f-]{36}$/i.test(d.id) || !/^[0-9a-f-]{36}$/i.test(d.account_id))
    throw new Error("invalid_id");
  if (typeof d.caption !== "string" || d.caption.length > 2200)
    throw new Error("invalid_caption");
  if (!["Feed", "Reel", "Story", "Carrossel"].includes(d.format))
    throw new Error("invalid_format");
  if (
    !d.scheduled_at ||
    !Number.isFinite(Date.parse(d.scheduled_at)) ||
    Date.parse(d.scheduled_at) < now
  )
    throw new Error("invalid_schedule");
  if (
    !Array.isArray(d.media_urls) ||
    d.media_urls.length < (d.format === "Carrossel" ? 2 : 1) ||
    d.media_urls.length > (d.format === "Carrossel" ? 10 : 1)
  )
    throw new Error("invalid_media");
  for (const value of d.media_urls) {
    if (typeof value !== "string" || value.length > 4096)
      throw new Error("invalid_media");
    let path: string;
    if (value.startsWith("storage://")) {
      path = value.slice(10);
      if (!path.startsWith(userId + "/") || path.includes(".."))
        throw new Error("invalid_media_owner");
    } else {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new Error("invalid_media");
      }
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error("invalid_media");
      path = url.pathname;
    }
    const video = /\.mp4$/i.test(path),
      photo = /\.jpe?g$/i.test(path);
    if (
      d.format === "Reel"
        ? !video
        : d.format === "Story"
          ? !video && !photo
          : !photo
    )
      throw new Error("invalid_media_format");
  }
}
export function mediaParams(
  format: Format,
  url: string,
  original: string,
): Record<string, string> {
  const video = /\.mp4(?:\?|$)/i.test(original);
  if (format === "Reel")
    return { media_type: "REELS", video_url: url, share_to_feed: "true" };
  if (format === "Story")
    return { media_type: "STORIES", [video ? "video_url" : "image_url"]: url };
  return { image_url: url };
}
