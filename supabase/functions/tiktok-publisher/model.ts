export class TikTokError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const privacyLevels = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
];
export interface Photo {
  path: string;
  type: "image/jpeg" | "image/webp";
}
export interface Settings {
  title: string;
  description: string;
  privacy: string;
  comments: boolean;
  music: boolean;
  commercial: boolean;
  ownBrand: boolean;
  branded: boolean;
  ai: boolean;
  cover: number;
}
export function validateSettings(value: unknown): Settings {
  const s = value as Settings;
  if (
    !s ||
    typeof s.title !== "string" ||
    s.title.length > 90 ||
    typeof s.description !== "string" ||
    s.description.length > 4000 ||
    !privacyLevels.includes(s.privacy)
  )
    throw new TikTokError("invalid_settings");
  for (const key of [
    "comments",
    "music",
    "commercial",
    "ownBrand",
    "branded",
    "ai",
  ] as const)
    if (typeof s[key] !== "boolean") throw new TikTokError("invalid_settings");
  if (!Number.isInteger(s.cover) || s.cover < 0 || s.cover > 34)
    throw new TikTokError("invalid_settings");
  if (s.commercial && !s.ownBrand && !s.branded)
    throw new TikTokError("commercial_required");
  if (
    (!s.commercial && (s.ownBrand || s.branded)) ||
    (s.branded && s.privacy === "SELF_ONLY")
  )
    throw new TikTokError("invalid_settings");
  return {
    title: s.title,
    description: s.description,
    privacy: s.privacy,
    comments: s.comments,
    music: s.music,
    commercial: s.commercial,
    ownBrand: s.ownBrand,
    branded: s.branded,
    ai: s.ai,
    cover: s.cover,
  };
}
export function validatePost(p: Record<string, unknown>, user: string) {
  if (!uuid(p.id) || !uuid(p.accountId) || p.consent !== true)
    throw new TikTokError("consent_required");
  const settings = validateSettings(p.settings);
  if (
    !Array.isArray(p.media) ||
    !p.media.length ||
    p.media.length > 35 ||
    settings.cover >= p.media.length
  )
    throw new TikTokError("invalid_media");
  const media = p.media.map((m: Photo) => {
    if (
      !m ||
      !["image/jpeg", "image/webp"].includes(m.type) ||
      typeof m.path !== "string" ||
      !m.path.startsWith(user + "/") ||
      !new RegExp("^" + user + "/[0-9a-f-]{36}\\.(jpg|webp)$").test(m.path)
    )
      throw new TikTokError("invalid_media");
    return { path: m.path, type: m.type };
  });
  if (new Set(media.map((m) => m.path)).size !== media.length)
    throw new TikTokError("invalid_media");
  const date =
    typeof p.scheduledAt === "string" ? Date.parse(p.scheduledAt) : NaN;
  if (!Number.isFinite(date) || date < Date.now() - 30000)
    throw new TikTokError("invalid_date");
  return {
    id: p.id,
    accountId: p.accountId,
    media,
    settings,
    scheduledAt: new Date(date).toISOString(),
  };
}
export function checkCreator(
  settings: Settings,
  creator: { privacy_level_options?: string[]; comment_disabled?: boolean },
) {
  if (
    !creator.privacy_level_options?.includes(settings.privacy) ||
    (settings.comments && creator.comment_disabled)
  )
    throw new TikTokError("settings_changed");
}
export function photoPayload(settings: Settings, urls: string[]) {
  return {
    post_mode: "DIRECT_POST",
    media_type: "PHOTO",
    is_aigc: settings.ai,
    post_info: {
      title: settings.title,
      description: settings.description,
      privacy_level: settings.privacy,
      disable_comment: !settings.comments,
      auto_add_music: settings.music,
      brand_organic_toggle: settings.ownBrand,
      brand_content_toggle: settings.branded,
    },
    source_info: {
      source: "PULL_FROM_URL",
      photo_cover_index: settings.cover,
      photo_images: urls,
    },
  };
}
