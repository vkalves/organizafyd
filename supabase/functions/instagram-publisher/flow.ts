import { validate, type Draft, type Format } from "./model.ts";
export type LibraryMedia = {
  id: string;
  url: string;
  kind: string;
  caption: string;
};
export type FlowInput = {
  id: string;
  name: string;
  accountIds: string[];
  mediaIds: string[];
  gapMinutes: number;
  random: boolean;
  distribution: "all" | "split";
  format: "auto" | "Reel" | "Feed";
  kind: "posts" | "stories";
  caption: string;
  variations: string[];
  startAt: string | null;
  coverId: string | null;
};
export function buildFlow(
  input: FlowInput,
  library: LibraryMedia[],
  userId: string,
  now = Date.now(),
  random = Math.random,
) {
  if (
    !input ||
    !/^[0-9a-f-]{36}$/i.test(input.id) ||
    typeof input.name !== "string" ||
    input.name.length > 120
  )
    throw new Error("invalid_flow");
  if (
    !Array.isArray(input.accountIds) ||
    !input.accountIds.length ||
    input.accountIds.length > 50 ||
    new Set(input.accountIds).size !== input.accountIds.length
  )
    throw new Error("invalid_accounts");
  if (
    !Array.isArray(input.mediaIds) ||
    !input.mediaIds.length ||
    new Set(input.mediaIds).size !== input.mediaIds.length
  )
    throw new Error("invalid_media");
  if (
    !Number.isFinite(input.gapMinutes) ||
    input.gapMinutes < 3 ||
    input.gapMinutes > 525600
  )
    throw new Error("invalid_gap");
  if (
    !["all", "split"].includes(input.distribution) ||
    !["auto", "Reel", "Feed"].includes(input.format) ||
    !["posts", "stories"].includes(input.kind) ||
    typeof input.random !== "boolean"
  )
    throw new Error("invalid_flow");
  if (
    typeof input.caption !== "string" ||
    input.caption.length > 2200 ||
    !Array.isArray(input.variations) ||
    input.variations.length > 100 ||
    input.variations.some((v) => typeof v !== "string" || v.length > 2200)
  )
    throw new Error("invalid_caption");
  const start = input.startAt ? Date.parse(input.startAt) : now + 60000;
  if (!Number.isFinite(start) || start <= now)
    throw new Error("invalid_schedule");
  const media = input.mediaIds.map((id) => {
    const item = library.find((m) => m.id === id && m.kind === input.kind);
    if (!item) throw new Error("invalid_media_owner");
    return item;
  });
  const cover = input.coverId
    ? library.find(
        (m) =>
          m.id === input.coverId && m.kind === "cover" && /\.jpg$/i.test(m.url),
      )
    : null;
  if (input.coverId && !cover) throw new Error("invalid_media_owner");
  const shuffle = <T>(values: T[]) => {
    const result = [...values];
    if (input.random)
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
    return result;
  };
  const split = shuffle(media);
  const jobs: (Draft & { cover_url: string | null })[] = [];
  input.accountIds.forEach((accountId, accountIndex) => {
    const items =
      input.distribution === "split"
        ? split.filter((_, i) => i % input.accountIds.length === accountIndex)
        : shuffle(media);
    items.forEach((item, index) => {
      const format: Format =
        input.kind === "stories"
          ? "Story"
          : input.format === "auto"
            ? /\.mp4$/i.test(item.url)
              ? "Reel"
              : "Feed"
            : input.format;
      const job = {
        id: crypto.randomUUID(),
        account_id: accountId,
        format,
        caption:
          format === "Story"
            ? ""
            : item.caption ||
              input.variations[index % (input.variations.length || 1)] ||
              input.caption,
        media_urls: [item.url],
        scheduled_at: new Date(
          start + index * input.gapMinutes * 60000 + accountIndex * 5000,
        ).toISOString(),
        cover_url: format === "Reel" ? (cover?.url ?? null) : null,
      };
      validate(job, userId, now);
      jobs.push(job);
    });
  });
  if (!jobs.length || jobs.length > 500) throw new Error("flow_too_large");
  return jobs;
}
