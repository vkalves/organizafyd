export type VideoMetric = {
  id: string;
  account_id: string;
  caption: string;
  timestamp: string;
  permalink: string | null;
  thumbnail_url: string | null;
  views: number | null;
  likes?: number | null;
  media_product_type?: string | null;
};
export type InsightsError =
  | "permission_required"
  | "temporarily_unavailable"
  | null;
type Graph = (
  path: string,
  params: Record<string, string>,
) => Promise<Record<string, unknown>>;
type Metric = {
  name: string;
  values?: { value: unknown }[];
  total_value?: { value: unknown };
};
type Media = {
  id: string;
  caption?: string;
  media_type: string;
  media_product_type?: string;
  like_count?: number;
  timestamp: string;
  permalink?: string;
  thumbnail_url?: string;
  insights?: { data?: Metric[] };
};
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
function metric(data: unknown, name: string) {
  if (!Array.isArray(data)) return null;
  const item = (data as Metric[]).find((value) => value.name === name);
  return count(item?.values?.[0]?.value ?? item?.total_value?.value);
}
function reason(error: unknown): Exclude<InsightsError, null> {
  return error instanceof Error && /^meta_(10|200)$/.test(error.message)
    ? "permission_required"
    : "temporarily_unavailable";
}
export async function readVideoAnalytics(
  accountId: string,
  graphId: string,
  graph: Graph,
  cursor?: string,
) {
  const fields =
    "id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,like_count";
  const params = { limit: "20", ...(cursor ? { after: cursor } : {}) };
  let response: Record<string, unknown>;
  let insightsError: InsightsError = null;
  try {
    // Field expansion reads one page of metrics in a single Graph request.
    // It was verified with the application's current Facebook Login tokens.
    response = await graph(`${graphId}/media`, {
      ...params,
      fields: `${fields},insights.metric(views,likes)`,
    });
  } catch (error) {
    insightsError = reason(error);
    // Insights authorization must never prevent reading basic media and likes.
    response = await graph(`${graphId}/media`, { ...params, fields });
  }
  if (!Array.isArray(response.data)) {
    throw new Error("invalid_analytics_response");
  }
  const media = (response.data as Media[]).filter((item) =>
    item.media_type === "VIDEO"
  );
  const videos: VideoMetric[] = [];
  for (let offset = 0; offset < media.length; offset += 4) {
    videos.push(
      ...await Promise.all(
        media.slice(offset, offset + 4).map(async (item) => {
          let insights = item.insights?.data;
          // Older/unsupported media can omit expanded insights. Isolate that failure
          // to this video, and stop retries for the page after a permission denial.
          if (!insights && insightsError !== "permission_required") {
            try {
              const result = await graph(`${item.id}/insights`, {
                metric: "views,likes",
              });
              insights = result.data as Metric[];
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
            timestamp: item.timestamp,
            permalink: item.permalink || null,
            thumbnail_url: item.thumbnail_url || null,
            views: metric(insights, "views"),
            likes: count(item.like_count) ?? metric(insights, "likes"),
            media_product_type: item.media_product_type ?? null,
          };
        }),
      ),
    );
  }
  const paging = response.paging as {
    next?: string;
    cursors?: { after?: string };
  } | undefined;
  const complete = !paging?.next;
  return {
    videos,
    complete,
    nextCursor: complete ? null : paging?.cursors?.after || null,
    insights_error: insightsError,
  };
}
