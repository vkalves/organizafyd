import { validate, type Draft, type Format } from "./model.ts";
import { isValidTimeZone, parseSlots, slotInstants } from "./schedule.ts";
export type LibraryMedia = {
  id: string;
  url: string;
  kind: string;
  caption: string;
  folder?: string;
};
export type FlowInput = {
  id: string;
  name: string;
  accountIds: string[];
  mediaIds: string[];
  gapMinutes: number;
  gapPostDelay?: boolean;
  random: boolean;
  distribution: "all" | "split";
  format: "auto" | "Reel" | "Feed";
  kind: "posts" | "stories";
  caption: string;
  variations: string[];
  startAt: string | null;
  coverId: string | null;
  repeat?: "once" | "loop";
  batchSize?: number;
  restMinutes?: number;
  avoidReuse?: boolean;
  folderCaptions?: Record<string, string[]>;
  schedule?: "gap" | "slots";
  slots?: string[];
  timeZone?: string;
};
export function buildFlow(
  input: FlowInput,
  library: LibraryMedia[],
  userId: string,
  now = Date.now(),
  random = Math.random,
  context: {
    used?: { account_id: string; url: string }[];
    offsets?: Record<string, number>;
    starts?: Record<string, number>;
    disabledAccounts?: string[];
    excluded?: { account_id: string; url: string }[];
  } = {},
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
  if (
    (input.repeat !== undefined && !["once", "loop"].includes(input.repeat)) ||
    (input.avoidReuse !== undefined && typeof input.avoidReuse !== "boolean") ||
    (input.batchSize !== undefined &&
      (!Number.isInteger(input.batchSize) ||
        input.batchSize < 1 ||
        input.batchSize > 500)) ||
    (input.restMinutes !== undefined &&
      (!Number.isFinite(input.restMinutes) ||
        input.restMinutes < 0 ||
        input.restMinutes > 10080))
  )
    throw new Error("invalid_campaign");
  if (
    input.folderCaptions !== undefined &&
    (typeof input.folderCaptions !== "object" ||
      input.folderCaptions === null ||
      Array.isArray(input.folderCaptions) ||
      Object.entries(input.folderCaptions).length > 100 ||
      Object.values(input.folderCaptions).some(
        (values) =>
          !Array.isArray(values) ||
          values.length > 100 ||
          values.some(
            (value) =>
              typeof value !== "string" || !value.trim() || value.length > 2200,
          ),
      ))
  )
    throw new Error("invalid_caption");
  const start = input.startAt ? Date.parse(input.startAt) : now + 60000;
  if (input.gapPostDelay !== undefined && typeof input.gapPostDelay !== "boolean")
    throw new Error("invalid_schedule");
  if (!Number.isFinite(start) || start <= now)
    throw new Error("invalid_schedule");
  if (
    input.schedule !== undefined &&
    input.schedule !== "gap" &&
    input.schedule !== "slots"
  )
    throw new Error("invalid_schedule");
  const slotMinutes =
    input.schedule === "slots" ? parseSlots(input.slots ?? []) : null;
  if (
    slotMinutes &&
    (!input.timeZone || !isValidTimeZone(input.timeZone))
  )
    throw new Error("invalid_timezone");

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
  // Loop campaigns keep the same split membership in every cycle.
  const stableHash = (value: string) =>
    [...value].reduce(
      (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0,
      2166136261,
    );
  const split =
    input.repeat === "loop" && input.distribution === "split"
      ? input.random
        ? [...media].sort(
            (a, b) => stableHash(input.id + a.id) - stableHash(input.id + b.id),
          )
        : [...media]
      : shuffle(media);
  const jobs: (Draft & { cover_url: string | null; flow_base_at?: string })[] = [];
  input.accountIds.forEach((accountId, accountIndex) => {
    if (context.disabledAccounts?.includes(accountId)) return;
    const items =
      input.distribution === "split"
        ? split.filter((_, i) => i % input.accountIds.length === accountIndex)
        : shuffle(media);
    const fresh = items.filter(
      (item) =>
        !context.excluded?.some(excluded => excluded.account_id === accountId && excluded.url === item.url) &&
        (!input.avoidReuse ||
        !context.used?.some(
          (used) => used.account_id === accountId && used.url === item.url,
        )),
    );
    const offset = context.offsets?.[accountId] ?? 0;
    const batch = input.batchSize || 500;
    const rest = (input.restMinutes || 0) * 60000;
    const ownStart = context.starts?.[accountId] ?? start;
    const times = slotMinutes
      ? slotInstants(fresh.length, ownStart, slotMinutes, input.timeZone!, {
          offset,
          batch,
          restMs: rest,
        })
      : null;
    fresh.forEach((item, index) => {
      const pool = input.folderCaptions?.[item.folder || ""] || [];
      const folderCaption = pool.length
        ? pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
        : "";
      const format: Format =
        input.kind === "stories"
          ? "Story"
          : input.format === "auto"
            ? /\.mp4$/i.test(item.url)
              ? "Reel"
              : "Feed"
            : input.format;
      const baseAt = times ? times[index] : ownStart + index * input.gapMinutes * 60000 +
        (Math.floor((offset + index) / batch) - Math.floor(offset / batch)) * rest;
      const delayed = input.schedule !== "slots" && input.gapPostDelay;
      const delayMs = delayed ? 60_000 + Math.min(240_000, Math.floor(random() * 240_001)) : accountIndex * 5000;
      const job = {
        id: crypto.randomUUID(),
        account_id: accountId,
        format,
        caption:
          format === "Story"
            ? ""
            : item.caption ||
              folderCaption ||
              input.variations[index % (input.variations.length || 1)] ||
              input.caption,
        media_urls: [item.url],
        scheduled_at: new Date(baseAt + delayMs).toISOString(),
        ...(delayed ? { flow_base_at: new Date(baseAt).toISOString() } : {}),
        cover_url: format === "Reel" ? (cover?.url ?? null) : null,
      };
      validate(job, userId, now);
      jobs.push(job);
    });
  });
  if (!jobs.length || jobs.length > 500)
    throw new Error(jobs.length ? "flow_too_large" : "no_unused_media");
  return jobs;
}
