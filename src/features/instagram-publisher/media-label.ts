export function mediaLabel(media: { id: string; caption?: string | null; folder?: string | null; kind?: string; format?: string }) {
  const caption = media.caption?.trim().replace(/\s+/g, " ");
  if (caption) return caption.length > 64 ? caption.slice(0, 61) + "…" : caption;
  const kind = media.format || (media.kind === "cover" ? "Capa" : media.kind === "stories" ? "Story" : "Reel");
  return `${media.folder?.trim() || kind} · ${media.id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}
