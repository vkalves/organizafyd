import { describe, expect, it, vi } from "vitest";
import { dayWindow } from "../../../supabase/functions/instagram-publisher/day-window";
import { readPublishedReelsToday } from "../../../supabase/functions/instagram-publisher/published-today";
import { publishedReelsTotal } from "./usePublishedReelsToday";

describe("Reels published on the current local day", () => {
  it("uses Fortaleza midnight boundaries rather than UTC or a rolling 24-hour window", () => {
    const before = dayWindow("America/Fortaleza", Date.parse("2026-11-12T02:59:59Z"));
    expect(new Date(before.start).toISOString()).toBe("2026-11-11T03:00:00.000Z");
    expect(new Date(before.end).toISOString()).toBe("2026-11-12T03:00:00.000Z");
    const after = dayWindow("America/Fortaleza", before.end);
    expect(after.start).toBe(before.end);
    const dst = dayWindow("America/New_York", Date.parse("2026-03-08T12:00:00Z"));
    expect(dst.end - dst.start).toBe(23 * 3600_000);
    expect(() => dayWindow("invalid/timezone")).toThrow("invalid_timezone");
  });
  it("counts actual Instagram Reels across every page and rejects adjacent days and other formats", async () => {
    const now = Date.parse("2026-11-12T02:59:59Z");
    const reel = (id: string, timestamp: string, product = "REELS") => ({ id, timestamp, media_type: "VIDEO", media_product_type: product });
    const graph = vi.fn().mockResolvedValueOnce({ data: [
      reel("midnight", "2026-11-11T03:00:00Z"),
      reel("yesterday", "2026-11-11T02:59:59Z"),
      reel("feed", "2026-11-11T14:00:00Z", "FEED"),
      { id: "photo", media_type: "IMAGE", timestamp: "2026-11-11T14:00:00Z" },
    ], paging: { next: "ignored", cursors: { after: "page2" } } }).mockResolvedValueOnce({ data: [
      reel("outside-site", "2026-11-11T18:00:00Z"),
      reel("midnight", "2026-11-11T03:00:00Z"),
      reel("next-day", "2026-11-12T03:00:00Z"),
    ] });
    expect(await readPublishedReelsToday("profile", graph, "America/Fortaleza", now)).toEqual({ count: 2, complete: true });
    expect(graph).toHaveBeenLastCalledWith("profile/media", expect.objectContaining({ after: "page2", since: String(Date.parse("2026-11-11T03:00:00Z") / 1000), until: String(Date.parse("2026-11-12T03:00:00Z") / 1000 - 1) }));
  });
  it("preserves incomplete counts, distinguishes unavailable accounts from a genuine zero, and does not need insight permissions", async () => {
    const graph = vi.fn().mockResolvedValueOnce({ data: [{ id: "reel", media_type: "VIDEO", media_product_type: "REELS", timestamp: "2026-11-11T12:00:00Z" }], paging: { next: "ignored", cursors: { after: "page2" } } }).mockRejectedValueOnce(new Error("offline"));
    expect(await readPublishedReelsToday("profile", graph, "America/Fortaleza", Date.parse("2026-11-11T18:00:00Z"))).toEqual({ count: 1, complete: false });
    const base = { start_at: "", end_at: "", checked_at: "", timezone: "America/Fortaleza" };
    expect(publishedReelsTotal({ ...base, accounts: [] })).toEqual({ count: 0, partial: false });
    expect(publishedReelsTotal({ ...base, accounts: [{ account_id: "a", count: null, unavailable: true, complete: false }] })).toEqual({ count: null, partial: true });
    expect(publishedReelsTotal({ ...base, accounts: [{ account_id: "a", count: 3, unavailable: false, complete: true }, { account_id: "b", count: 4, unavailable: false, complete: true }] })).toEqual({ count: 7, partial: false });
  });
});
