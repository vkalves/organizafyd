import type { AnalyticsReport } from "./useInstagramAnalytics";

// Missing permissions or an incomplete page must never become a fabricated zero.
export function reelMetrics(accountIds: string[], report?: AnalyticsReport) {
  return Object.fromEntries((["views", "likes"] as const).map(metric => {
    let total = 0;
    let available = false;
    let partial = false;
    for (const accountId of accountIds) {
      const account = report?.accounts.find(a => a.account_id === accountId);
      if (!account || account.unavailable) { partial = true; continue; }
      const videos = [...new Map(account.videos.filter(v => v.account_id === accountId).map(v => [v.id, v])).values()];
      partial ||= !account.complete || videos.some(v => !v.media_product_type);
      const reels = videos.filter(v => v.media_product_type === "REELS");
      if (account.complete && !reels.length && !videos.some(v => !v.media_product_type)) available = true;
      for (const reel of reels) {
        const value = reel[metric];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          total += value;
          available = true;
        } else partial = true;
      }
    }
    return [metric, { value: available || (report && !accountIds.length) ? total : null, partial }];
  })) as Record<"views" | "likes", { value: number | null; partial: boolean }>;
}
