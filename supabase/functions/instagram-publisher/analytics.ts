export type VideoMetric = {
  id: string;
  account_id: string;
  caption: string;
  timestamp: string;
  permalink: string | null;
  thumbnail_url: string | null;
  views: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  reach?: number | null;
  interactions?: number | null;
  media_product_type?: string | null;
};
export type InsightsError =
  | "permission_required"
  | "temporarily_unavailable"
  | null;
export type AccountProfile = {
  username: string | null;
  name: string | null;
  followers_count: number | null;
  follows_count: number | null;
  media_count: number | null;
  profile_picture_url: string | null;
};
export type AccountInsights = {
  period_days: number;
  since: string;
  until: string;
  views: number | null;
  reach: number | null;
  accounts_engaged: number | null;
  total_interactions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  /** Daily follower gains reported by Meta (follower_count, period=day). */
  follower_series: { date: string; value: number }[];
  new_followers: number | null;
};
export type AccountOverview = {
  profile: AccountProfile | null;
  insights: AccountInsights | null;
  insights_error: InsightsError;
};
type Graph = (
  path: string,
  params: Record<string, string>,
) => Promise<Record<string, unknown>>;
type Metric = {
  name: string;
  values?: { value: unknown; end_time?: string }[];
  total_value?: { value: unknown };
};
type Media = {
  id: string;
  caption?: string;
  media_type: string;
  media_product_type?: string;
  like_count?: number;
  comments_count?: number;
  timestamp: string;
  permalink?: string;
  thumbnail_url?: string;
  insights?: { data?: Metric[] };
};
// Valid media insights across IG media on Graph API v24.0
// (comments_count is read natively via BASE_FIELDS so non-Reel photos on the page never reject expansion).
const MEDIA_METRICS = "views,likes,reach,shares,saved,total_interactions";
const CORE_MEDIA_METRICS = "views,likes";
const BASE_FIELDS =
  "id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,like_count,comments_count";
const ACCOUNT_TOTAL_METRICS = [
  "views",
  "accounts_engaged",
  "total_interactions",
  "likes",
  "comments",
  "shares",
  "saves",
] as const;
const PAGE_SIZE = "50";
/** Pages scanned in one request when a page contains no videos at all. */
const MAX_EMPTY_PAGES = 5;

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
function metric(data: unknown, name: string) {
  if (!Array.isArray(data)) return null;
  const item = (data as Metric[]).find((value) => value.name === name);
  return count(item?.values?.[0]?.value ?? item?.total_value?.value);
}
/** Meta returns "2026-11-13T12:00:00+0000", which some browsers (Safari) cannot parse. */
export function normalizeTimestamp(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const fixed = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const time = Date.parse(fixed);
  return Number.isFinite(time) ? new Date(time).toISOString() : value;
}
function graphMessage(error: unknown) {
  const details = (error as { details?: { message?: unknown } })?.details;
  return typeof details?.message === "string" ? details.message : "";
}
/**
 * Code 10 is shared by "permission denied" and "not enough viewers for insights".
 * Only a real authorization failure may stop insight retries for an account.
 */
export function reason(error: unknown): Exclude<InsightsError, null> {
  if (!(error instanceof Error)) return "temporarily_unavailable";
  const code = /^meta_(\d+)$/.exec(error.message)?.[1];
  if (code === "200" || code === "190") return "permission_required";
  if (code === "10") {
    const message = graphMessage(error);
    if (!message) return "permission_required";
    return /permiss|scope|authoriz|not authorized|access/i.test(message) &&
        !/enough|viewers|not available|unsupported|before/i.test(message)
      ? "permission_required"
      : "temporarily_unavailable";
  }
  return "temporarily_unavailable";
}
function isVideo(item: Media) {
  return (
    item.media_type === "VIDEO" ||
    item.media_type === "REELS" ||
    item.media_product_type === "REELS"
  );
}
async function mediaInsights(id: string, graph: Graph) {
  try {
    return (await graph(`${id}/insights`, { metric: MEDIA_METRICS })).data as Metric[];
  } catch (error) {
    if (reason(error) === "permission_required") throw error;
    // One unsupported metric fails the whole call; retry the essential metric only.
    return (await graph(`${id}/insights`, { metric: "views" })).data as Metric[];
  }
}
export async function readVideoAnalytics(
  accountId: string,
  graphId: string,
  graph: Graph,
  cursor?: string,
) {
  let after = cursor;
  let insightsError: InsightsError = null;
  let media: Media[] = [];
  let paging: { next?: string; cursors?: { after?: string } } | undefined;
  for (let page = 0; page < MAX_EMPTY_PAGES; page++) {
    const params = { limit: PAGE_SIZE, ...(after ? { after } : {}) };
    let response: Record<string, unknown>;
    if (insightsError === "permission_required") {
      response = await graph(`${graphId}/media`, { ...params, fields: BASE_FIELDS });
    } else {
      try {
        // Field expansion reads one page of metrics in a single Graph request.
        response = await graph(`${graphId}/media`, {
          ...params,
          fields: `${BASE_FIELDS},insights.metric(${MEDIA_METRICS})`,
        });
      } catch (error) {
        const failed = reason(error);
        if (failed === "permission_required") {
          insightsError = "permission_required";
          response = await graph(`${graphId}/media`, { ...params, fields: BASE_FIELDS });
        } else if (/^meta_100$/.test(error instanceof Error ? error.message : "")) {
          // Older photos/carousels on the same page can reject secondary insight metrics;
          // retry core views,likes expansion before falling back to unexpanded media.
          try {
            response = await graph(`${graphId}/media`, {
              ...params,
              fields: `${BASE_FIELDS},insights.metric(${CORE_MEDIA_METRICS})`,
            });
          } catch (coreErr) {
            const coreFailed = reason(coreErr);
            if (coreFailed === "permission_required" || insightsError === null) {
              insightsError = coreFailed;
            }
            response = await graph(`${graphId}/media`, { ...params, fields: BASE_FIELDS });
          }
        } else {
          if (insightsError === null) insightsError = failed;
          // Insights authorization must never prevent reading basic media and likes.
          response = await graph(`${graphId}/media`, { ...params, fields: BASE_FIELDS });
        }
      }
    }
    if (!Array.isArray(response.data)) {
      throw new Error("invalid_analytics_response");
    }
    paging = response.paging as typeof paging;
    media = (response.data as Media[]).filter(isVideo);
    after = paging?.next ? paging?.cursors?.after : undefined;
    // Recent photos/carousels must not hide every video behind a manual "load more".
    if (media.length || !after) break;
  }
  const videos: VideoMetric[] = [];
  for (let offset = 0; offset < media.length; offset += 4) {
    videos.push(
      ...await Promise.all(
        media.slice(offset, offset + 4).map(async (item) => {
          let insights = item.insights?.data;
          // Older/unsupported media can omit expanded insights. Isolate that failure
          // to this video, and stop retries after a real permission denial.
          if (!insights && insightsError !== "permission_required") {
            try {
              insights = await mediaInsights(item.id, graph);
            } catch (error) {
              const failed = reason(error);
              if (failed === "permission_required" || insightsError === null) {
                insightsError = failed;
              }
            }
          }
          return {
            id: item.id,
            account_id: accountId,
            caption: item.caption || "Sem legenda",
            timestamp: normalizeTimestamp(item.timestamp),
            permalink: item.permalink || null,
            thumbnail_url: item.thumbnail_url || null,
            views: metric(insights, "views"),
            likes: count(item.like_count) ?? metric(insights, "likes"),
            comments: count(item.comments_count) ?? metric(insights, "comments"),
            shares: metric(insights, "shares"),
            saves: metric(insights, "saved"),
            reach: metric(insights, "reach"),
            interactions: metric(insights, "total_interactions"),
            media_product_type:
              item.media_product_type ?? (item.media_type === "REELS" ? "REELS" : null),
          };
        }),
      ),
    );
  }
  const complete = !paging?.next;
  return {
    videos,
    complete,
    nextCursor: complete ? null : paging?.cursors?.after || null,
    insights_error: insightsError,
  };
}

async function readProfile(graphId: string, graph: Graph): Promise<AccountProfile | null> {
  let data: Record<string, unknown>;
  try {
    data = await graph(graphId, {
      fields: "id,username,name,followers_count,follows_count,media_count,profile_picture_url",
    });
  } catch {
    try {
      data = await graph(graphId, { fields: "id,username,followers_count,media_count" });
    } catch {
      return null;
    }
  }
  const text = (value: unknown) => typeof value === "string" && value ? value : null;
  const picture = text(data.profile_picture_url);
  return {
    username: text(data.username),
    name: text(data.name),
    followers_count: count(data.followers_count),
    follows_count: count(data.follows_count),
    media_count: count(data.media_count),
    profile_picture_url: picture && /^https:\/\//i.test(picture) ? picture : null,
  };
}

/** Account-level overview: profile counters and the last 28 days of account insights. */
export async function readAccountOverview(
  graphId: string,
  graph: Graph,
  now = Date.now(),
): Promise<AccountOverview> {
  const days = 28;
  const until = Math.floor(now / 1000);
  const since = until - days * 86400;
  let insightsError: InsightsError = null;
  const note = (error: unknown) => {
    const failed = reason(error);
    if (failed === "permission_required" || insightsError === null) insightsError = failed;
  };
  const range = { period: "day", since: String(since), until: String(until) };
  const [profile, totals, reach28d, series] = await Promise.all([
    readProfile(graphId, graph),
    (async () => {
      try {
        const result = await graph(`${graphId}/insights`, {
          ...range,
          metric: ACCOUNT_TOTAL_METRICS.join(","),
          metric_type: "total_value",
        });
        return result.data as Metric[];
      } catch (error) {
        note(error);
        if (insightsError === "permission_required") return [] as Metric[];
        // A metric unsupported for this account must not hide the others.
        const each = await Promise.allSettled(
          ACCOUNT_TOTAL_METRICS.map((name) =>
            graph(`${graphId}/insights`, { ...range, metric: name, metric_type: "total_value" })
          ),
        );
        return each.flatMap((item) =>
          item.status === "fulfilled" && Array.isArray(item.value.data)
            ? item.value.data as Metric[]
            : []
        );
      }
    })(),
    (async () => {
      try {
        // On Graph API v24.0, reach uses period=days_28 (time_series) rather than metric_type=total_value.
        const result = await graph(`${graphId}/insights`, {
          metric: "reach",
          period: "days_28",
        });
        return metric(result.data, "reach");
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        // follower_count only accepts the last 30 days and excludes today.
        const result = await graph(`${graphId}/insights`, {
          metric: "follower_count",
          period: "day",
          since: String(until - 29 * 86400),
          until: String(until),
        });
        const item = (result.data as Metric[] | undefined)?.find((m) => m.name === "follower_count");
        return (item?.values ?? []).flatMap((value) => {
          const n = count(value.value);
          return n === null || !value.end_time
            ? []
            : [{ date: normalizeTimestamp(value.end_time), value: n }];
        });
      } catch (error) {
        // Accounts under 100 followers do not get follower_count; not an error.
        if (reason(error) === "permission_required") note(error);
        return null;
      }
    })(),
  ]);
  const reachTotal = metric(totals, "reach") ?? reach28d;
  const hasTotals =
    reachTotal !== null || ACCOUNT_TOTAL_METRICS.some((name) => metric(totals, name) !== null);
  const insights: AccountInsights | null = hasTotals || series?.length
    ? {
      period_days: days,
      since: new Date(since * 1000).toISOString(),
      until: new Date(until * 1000).toISOString(),
      views: metric(totals, "views"),
      reach: reachTotal,
      accounts_engaged: metric(totals, "accounts_engaged"),
      total_interactions: metric(totals, "total_interactions"),
      likes: metric(totals, "likes"),
      comments: metric(totals, "comments"),
      shares: metric(totals, "shares"),
      saves: metric(totals, "saves"),
      follower_series: series ?? [],
      new_followers: series?.length ? series.reduce((sum, item) => sum + item.value, 0) : null,
    }
    : null;
  return { profile, insights, insights_error: insightsError };
}
