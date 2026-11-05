export type VideoMetric = {
  id: string;
  account_id: string;
  caption: string;
  timestamp: string;
  permalink: string | null;
  thumbnail_url: string | null;
  views: number | null;
};
type Graph = (
  path: string,
  params: Record<string, string>,
) => Promise<Record<string, unknown>>;
export async function readVideoAnalytics(
  accountId: string,
  graphId: string,
  graph: Graph,
  cursor?: string,
) {
  const videos: VideoMetric[] = [];
  let after: string | undefined = cursor;
  let complete = false;
  const response = await graph(`${graphId}/media`, {
    fields:
      "id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url",
    limit: "20",
    ...(after ? { after } : {}),
  });
  const data = response.data as {
    id: string;
    caption?: string;
    media_type: string;
    timestamp: string;
    permalink?: string;
    thumbnail_url?: string;
  }[];
  if (!Array.isArray(data)) throw new Error("invalid_analytics_response");
  const pageVideos = data.filter((m) => m.media_type === "VIDEO");
  for (let offset = 0; offset < pageVideos.length; offset += 4) {
    const batch = await Promise.all(
      pageVideos.slice(offset, offset + 4).map(async (media) => {
        let views: number | null = null;
        try {
          const insights = await graph(`${media.id}/insights`, {
            metric: "views",
          });
          const metrics = insights.data as {
            name: string;
            values?: { value: number }[];
            total_value?: { value: number };
          }[];
          const metric = metrics?.find((m) => m.name === "views");
          const value =
            metric?.values?.[0]?.value ?? metric?.total_value?.value;
          if (typeof value === "number" && Number.isFinite(value) && value >= 0)
            views = value;
        } catch {
          /* Missing insight permission or unsupported media is unknown, never zero. */
        }
        return {
          id: media.id,
          account_id: accountId,
          caption: media.caption || "Sem legenda",
          timestamp: media.timestamp,
          permalink: media.permalink || null,
          thumbnail_url: media.thumbnail_url || null,
          views,
        };
      }),
    );
    videos.push(...batch);
  }
  const paging = response.paging as
    { next?: string; cursors?: { after?: string } } | undefined;
  after = paging?.cursors?.after;
  complete = !paging?.next;
  return { videos, complete, nextCursor: complete ? null : after || null };
}
