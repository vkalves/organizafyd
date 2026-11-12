import { describe, expect, it } from "vitest";
import { reelMetrics } from "./reel-metrics";
import type { AnalyticsReport } from "./useInstagramAnalytics";

const video = (id: string, views: number | null, likes: number | null, product = "REELS") => ({
  id, account_id: "a", views, likes, media_product_type: product,
  caption: "", timestamp: "2026-11-01", permalink: null, thumbnail_url: null,
});
const report = (videos: ReturnType<typeof video>[], complete = true): AnalyticsReport => ({
  checked_at: "2026-11-12", accounts: [{ account_id: "a", videos, complete, unavailable: false }],
});
describe("dashboard Reel totals", () => {
  it("counts only Reels, deduplicates media and respects connected account ownership", () => {
    const data = report([video("r", 100, 5), video("r", 100, 5), video("feed", 999, 999, "FEED"), { ...video("other", 999, 999), account_id: "other" }]);
    expect(reelMetrics(["a"], data)).toEqual({ views: { value: 100, partial: false }, likes: { value: 5, partial: false } });
  });
  it("keeps zero, missing metrics, unavailable accounts and partial histories distinct", () => {
    expect(reelMetrics(["a"], report([video("r", 0, null)]))).toEqual({ views: { value: 0, partial: false }, likes: { value: null, partial: true } });
    expect(reelMetrics(["a", "missing"], report([video("r", 100, 2)], false)).likes).toEqual({ value: 2, partial: true });
    expect(reelMetrics(["a"], report([])).likes).toEqual({ value: 0, partial: false });
    expect(reelMetrics(["a"], { checked_at: "", accounts: [{ account_id: "a", complete: false, unavailable: true, videos: [] }] }).likes.value).toBeNull();
    expect(reelMetrics(["a"], report([video("legacy", 100, null, "")])).views).toEqual({ value: null, partial: true });
  });
});
