import { describe, expect, it } from "vitest";
import { accountViewsRanking } from "./account-views-ranking";
import type { AnalyticsReport } from "./useInstagramAnalytics";
const accounts = [
  { id: "a", username: "alfa" },
  { id: "b", username: "beta" },
  { id: "c", username: "gama" },
];
const video = (id: string, account_id: string, views: number | null) => ({
  id,
  account_id,
  views,
  caption: "",
  timestamp: "2026-11-01T12:00:00Z",
  permalink: null,
  thumbnail_url: null,
});
const report = (rows: AnalyticsReport["accounts"]): AnalyticsReport => ({
  accounts: rows,
  checked_at: "2026-11-09T12:00:00Z",
});
const now = Date.parse("2026-11-09T13:00:00Z");
describe("Dashboard ranking from Meta analytics", () => {
  it("orders and sums real metrics instead of placeholder fields on account records", () => {
    const ranked = accountViewsRanking(
      accounts,
      report([
        {
          account_id: "a",
          videos: [video("a1", "a", 100), video("a2", "a", 50)],
          complete: true,
          unavailable: false,
        },
        {
          account_id: "b",
          videos: [video("b1", "b", 700)],
          complete: true,
          unavailable: false,
        },
      ]),
      now,
    );
    expect(ranked.rows.map((r) => [r.id, r.views])).toEqual([
      ["b", 700],
      ["a", 150],
      ["c", null],
    ]);
    expect(ranked.totalViews).toBe(850);
    expect(ranked.best?.id).toBe("b");
    expect(ranked.lowest?.id).toBe("a");
  });
  it("does not turn missing, unavailable or inaccessible metrics into zero or award them last place", () => {
    const ranked = accountViewsRanking(
      accounts,
      report([
        {
          account_id: "a",
          videos: [video("a1", "a", null)],
          complete: true,
          unavailable: false,
        },
        { account_id: "b", videos: [], complete: false, unavailable: true },
      ]),
      now,
    );
    expect(ranked.rows.every((r) => r.views === null)).toBe(true);
    expect(ranked.totalViews).toBeNull();
    expect(ranked.best).toBeUndefined();
    expect(ranked.lowestAccounts).toEqual([]);
  });
  it("keeps a confirmed zero and an empty complete library distinct from an unconsulted page", () => {
    const ranked = accountViewsRanking(
      accounts,
      report([
        {
          account_id: "a",
          videos: [video("a1", "a", 0)],
          complete: true,
          unavailable: false,
        },
        { account_id: "b", videos: [], complete: true, unavailable: false },
        {
          account_id: "c",
          videos: [],
          complete: false,
          nextCursor: "next",
          unavailable: false,
        },
      ]),
      now,
    );
    expect(ranked.rows.map((r) => r.views)).toEqual([0, 0, null]);
    expect(ranked.totalViews).toBe(0);
    expect(ranked.lowestAccounts).toHaveLength(2);
    expect(ranked.hasMore).toBe(true);
  });
  it("marks partial totals when more pages or unavailable video metrics remain", () => {
    const ranked = accountViewsRanking(
      accounts.slice(0, 1),
      report([
        {
          account_id: "a",
          videos: [video("a1", "a", 20), video("a2", "a", null)],
          complete: false,
          nextCursor: "next",
          unavailable: false,
        },
      ]),
      now,
    );
    expect(ranked.totalViews).toBe(20);
    expect(ranked.partial).toBe(true);
    expect(ranked.rows[0].measuredVideos).toBe(1);
  });
  it("ignores duplicate videos, foreign accounts, future videos and invalid metric values", () => {
    const ranked = accountViewsRanking(
      accounts.slice(0, 1),
      report([
        {
          account_id: "a",
          videos: [
            video("a1", "a", 10),
            video("a1", "a", 20),
            video("foreign", "b", 9999),
            video("bad", "a", -1),
            {
              ...video("future", "a", 9999),
              timestamp: "2027-01-01T00:00:00Z",
            },
          ],
          complete: true,
          unavailable: false,
        },
        {
          account_id: "foreign",
          videos: [video("f1", "foreign", 9999)],
          complete: true,
          unavailable: false,
        },
      ]),
      now,
    );
    expect(ranked.totalViews).toBe(20);
    expect(ranked.rows).toHaveLength(1);
    expect(ranked.partial).toBe(true);
  });
  it("shows unknown totals before the first report is available", () => {
    const ranked = accountViewsRanking(accounts, undefined, now);
    expect(ranked.totalViews).toBeNull();
    expect(ranked.rows.every((r) => r.views === null)).toBe(true);
  });
});
