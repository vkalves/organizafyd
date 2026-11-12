import { dayWindow } from "./day-window.ts";

type Graph = (path: string, params: Record<string, string>) => Promise<Record<string, unknown>>;
export type PublishedTodayReport = {
  accounts: { account_id: string; count: number | null; complete: boolean; unavailable: boolean }[];
  start_at: string;
  end_at: string;
  checked_at: string;
  timezone: string;
};

export async function readPublishedReelsToday(graphId: string, graph: Graph, timezone: string, now = Date.now()) {
  const { start, end } = dayWindow(timezone, now);
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let after: string | undefined;
  let valid = true;
  for (let page = 0; page < 10; page++) {
    let response: Record<string, unknown>;
    try {
      response = await graph(`${graphId}/media`, {
        fields: "id,media_type,media_product_type,timestamp",
        since: String(Math.floor(start / 1000)),
        until: String(Math.floor(end / 1000) - 1),
        limit: "100",
        ...(after ? { after } : {}),
      });
      if (!Array.isArray(response.data)) throw new Error("invalid_publications_response");
    } catch (error) {
      if (!page) throw error;
      return { count: ids.size, complete: false };
    }
    for (const media of response.data as { id?: string; media_type?: string; media_product_type?: string; timestamp?: string }[]) {
      if (media.media_type !== "VIDEO") continue;
      if (!media.media_product_type) { valid = false; continue; }
      if (media.media_product_type !== "REELS") continue;
      const published = Date.parse(media.timestamp ?? "");
      if (!media.id || !Number.isFinite(published)) { valid = false; continue; }
      // Enforce the half-open local day even if Meta includes an adjacent boundary.
      if (published >= start && published < end && published <= now) ids.add(media.id);
    }
    const paging = response.paging as { next?: string; cursors?: { after?: string } } | undefined;
    if (!paging?.next) return { count: ids.size, complete: valid };
    after = paging.cursors?.after;
    if (!after || cursors.has(after)) return { count: ids.size, complete: false };
    cursors.add(after);
  }
  return { count: ids.size, complete: false };
}
