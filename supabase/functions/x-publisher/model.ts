export class XError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export interface Media {
  path: string;
  type: string;
  name: string;
}
export interface PostInput {
  id: string;
  accountId: string;
  text: string;
  media: Media[];
  scheduledAt: string;
}
export const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
// Conservative counter: X counts URLs as 23 and many non-Latin characters as 2.
// Emoji sequences may be overcounted, never silently truncated.
export function textWeight(text: string): number {
  return Array.from(text.replace(/https?:\/\/[^\s]+/g, "x".repeat(23))).reduce(
    (sum, char) => {
      const cp = char.codePointAt(0)!;
      return (
        sum +
        (cp <= 0x10ff ||
        (cp >= 0x2000 && cp <= 0x200d) ||
        (cp >= 0x2010 && cp <= 0x201f) ||
        (cp >= 0x2032 && cp <= 0x2037)
          ? 1
          : 2)
      );
    },
    0,
  );
}
export function validatePost(
  value: Record<string, unknown>,
  userId: string,
  now = Date.now(),
): PostInput {
  if (!uuid(value.id) || !uuid(value.accountId))
    throw new XError("invalid_post");
  if (typeof value.text !== "string" || textWeight(value.text) > 280)
    throw new XError("invalid_text");
  if (!Array.isArray(value.media) || value.media.length > 4)
    throw new XError("invalid_media");
  const media = value.media as Media[];
  if (
    media.some(
      (m) =>
        !m ||
        typeof m.path !== "string" ||
        !new RegExp(`^${userId}/[0-9a-f-]{36}\\.(jpg|png|mp4)$`, "i").test(
          m.path,
        ) ||
        !["image/jpeg", "image/png", "video/mp4"].includes(m.type) ||
        typeof m.name !== "string" ||
        m.name.length > 255,
    )
  )
    throw new XError("invalid_media");
  if (media.some((m) => m.type === "video/mp4") && media.length !== 1)
    throw new XError("invalid_media");
  if (!value.text.trim() && !media.length) throw new XError("empty_post");
  const time =
    typeof value.scheduledAt === "string" ? Date.parse(value.scheduledAt) : NaN;
  if (
    !Number.isFinite(time) ||
    time < now + 30_000 ||
    time > now + 366 * 86400_000
  )
    throw new XError("invalid_schedule");
  return {
    id: value.id,
    accountId: value.accountId,
    text: value.text.trim(),
    media,
    scheduledAt: new Date(time).toISOString(),
  };
}
