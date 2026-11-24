import { describe, expect, it, vi } from "vitest";
import {
  normalizeTimestamp,
  readAccountOverview,
  readVideoAnalytics,
} from "../../../supabase/functions/instagram-publisher/analytics";
describe("Instagram video insights", () => {
  it("returns Reel classification and genuine likes independently of insight availability", async () => {
    const graph = vi.fn(async (path: string) => {
      if (path === "profile/media") {
        return {
          data: [
            {
              id: "reel",
              media_type: "VIDEO",
              media_product_type: "REELS",
              like_count: 0,
            },
            {
              id: "video",
              media_type: "VIDEO",
              media_product_type: "FEED",
              like_count: 12,
            },
            { id: "hidden", media_type: "VIDEO", media_product_type: "REELS" },
          ],
        };
      }
      throw new Error("insight permission missing");
    });
    const result = await readVideoAnalytics("owner", "profile", graph);
    expect(
      result.videos.map((v) => [v.id, v.media_product_type, v.likes, v.views]),
    ).toEqual([
      ["reel", "REELS", 0, null],
      ["video", "FEED", 12, null],
      ["hidden", "REELS", null, null],
    ]);
    expect(graph).toHaveBeenCalledWith(
      "profile/media",
      expect.objectContaining({
        fields: expect.stringContaining("like_count"),
      }),
    );
  });
  it("paginates with cursors, excludes photos and distinguishes zero views from missing insights", async () => {
    const graph = vi.fn(
      async (path: string, params: Record<string, string>) => {
        if (path === "profile/media") {
          return params.after
            ? {
              data: [
                { id: "v2", media_type: "VIDEO", timestamp: "2026-11-01" },
              ],
            }
            : {
              data: [
                { id: "photo", media_type: "IMAGE" },
                { id: "v1", media_type: "VIDEO", timestamp: "2026-11-01" },
              ],
              paging: {
                next: "https://unused.example",
                cursors: { after: "cursor" },
              },
            };
        }
        if (path === "v1/insights") {
          return { data: [{ name: "views", values: [{ value: 0 }] }] };
        }
        throw new Error("permission denied");
      },
    );
    const result = await readVideoAnalytics("owner", "profile", graph);
    expect(result.complete).toBe(false);
    expect(result.nextCursor).toBe("cursor");
    const next = await readVideoAnalytics(
      "owner",
      "profile",
      graph,
      result.nextCursor!,
    );
    expect(next.complete).toBe(true);
    expect(
      [...result.videos, ...next.videos].map((v) => [
        v.account_id,
        v.id,
        v.views,
      ]),
    ).toEqual([
      ["owner", "v1", 0],
      ["owner", "v2", null],
    ]);
    expect(graph).toHaveBeenCalledWith(
      "profile/media",
      expect.objectContaining({ after: "cursor" }),
    );
  });
  it("marks a paginated response as partial without losing a cursor", async () => {
    const graph = vi.fn(async (path: string, params: Record<string, string>) => ({
      data: params.after ? [{ id: "v", media_type: "VIDEO", timestamp: "2026-11-01" }] : [],
      paging: {
        next: "https://unused.example",
        cursors: { after: "next-page" },
      },
    }));
    const result = await readVideoAnalytics("owner", "profile", graph);
    expect(result.complete).toBe(false);
    expect(result.nextCursor).toBe("next-page");
  });
});

it("reads expanded views and likes for a page in one Graph request", async () => {
  const graph = vi.fn(async () => ({
    data: [{
      id: "r",
      media_type: "VIDEO",
      media_product_type: "REELS",
      timestamp: "2026-11-13T12:00:00+0000",
      insights: {
        data: [
          { name: "views", total_value: { value: 1234 } },
          { name: "likes", values: [{ value: 56 }] },
          { name: "comments", values: [{ value: 7 }] },
          { name: "shares", values: [{ value: 8 }] },
          { name: "saved", values: [{ value: 9 }] },
          { name: "reach", values: [{ value: 900 }] },
          { name: "total_interactions", values: [{ value: 80 }] },
        ],
      },
    }],
  }));
  const result = await readVideoAnalytics("owner", "profile", graph);
  expect(result.videos[0]).toMatchObject({
    views: 1234,
    likes: 56,
    comments: 7,
    shares: 8,
    saves: 9,
    reach: 900,
    interactions: 80,
    timestamp: "2026-11-13T12:00:00.000Z",
  });
  expect(result.insights_error).toBeNull();
  expect(graph).toHaveBeenCalledTimes(1);
  expect(graph).toHaveBeenCalledWith(
    "profile/media",
    expect.objectContaining({
      fields: expect.stringContaining("insights.metric(views,likes"),
    }),
  );
});
it("keeps likes and does not retry every video when Meta denies insights", async () => {
  const graph = vi.fn(async (_path: string, params: Record<string, string>) => {
    if (params.fields.includes("insights.")) throw new Error("meta_10");
    return {
      data: Array.from(
        { length: 20 },
        (_, i) => ({
          id: String(i),
          media_type: "VIDEO",
          media_product_type: "REELS",
          timestamp: "2026-11-13",
          like_count: i,
        }),
      ),
    };
  });
  const result = await readVideoAnalytics("owner", "profile", graph);
  expect(result.insights_error).toBe("permission_required");
  expect(result.videos[0]).toMatchObject({ views: null, likes: 0 });
  expect(result.videos[19]).toMatchObject({ views: null, likes: 19 });
  expect(graph).toHaveBeenCalledTimes(2);
});

it("scans past photo-only pages and recognizes REELS reported as media_type=REELS", async () => {
  const graph = vi.fn(async (_path: string, params: Record<string, string>) => {
    if (!params.after) {
      return {
        data: [{ id: "img-1", media_type: "IMAGE", timestamp: "2026-11-13" }],
        paging: { next: "https://graph.example/p2", cursors: { after: "p2" } },
      };
    }
    return {
      data: [{
        id: "reel-1",
        media_type: "REELS",
        media_product_type: "REELS",
        timestamp: "2026-11-12T10:00:00+0000",
        like_count: 42,
        insights: { data: [{ name: "views", values: [{ value: 980 }] }] },
      }],
    };
  });
  const result = await readVideoAnalytics("owner", "profile", graph);
  expect(result.videos).toHaveLength(1);
  expect(result.videos[0]).toMatchObject({
    id: "reel-1",
    views: 980,
    likes: 42,
    timestamp: "2026-11-12T10:00:00.000Z",
  });
  expect(result.complete).toBe(true);
});

it("isolates code 10 'Not enough viewers' on one video instead of blocking subsequent videos", async () => {
  const notEnoughViewers = Object.assign(new Error("meta_10"), {
    details: { message: "Not enough viewers for this media to show insights" },
  });
  const graph = vi.fn(async (path: string, params: Record<string, string>) => {
    if (path === "profile/media") {
      if (params.fields.includes("insights.")) throw notEnoughViewers;
      return {
        data: [
          { id: "low", media_type: "VIDEO", media_product_type: "REELS", timestamp: "2026-11-13", like_count: 1 },
          { id: "ok", media_type: "VIDEO", media_product_type: "REELS", timestamp: "2026-11-13", like_count: 15 },
        ],
      };
    }
    if (path === "low/insights") throw notEnoughViewers;
    if (path === "ok/insights") {
      return { data: [{ name: "views", values: [{ value: 450 }] }] };
    }
    throw new Error("unexpected");
  });
  const result = await readVideoAnalytics("owner", "profile", graph);
  expect(result.insights_error).toBe("temporarily_unavailable");
  expect(result.videos.map((v) => [v.id, v.views, v.likes])).toEqual([
    ["low", null, 1],
    ["ok", 450, 15],
  ]);
});

it("reads account profile followers and 28-day account insights", async () => {
  const graph = vi.fn(async (path: string, params: Record<string, string>) => {
    if (path === "profile") {
      return {
        id: "profile",
        username: "avanca.oficial",
        name: "Avança",
        followers_count: 15420,
        follows_count: 310,
        media_count: 88,
        profile_picture_url: "https://cdn.example/pic.jpg",
      };
    }
    if (path === "profile/insights" && params.metric_type === "total_value") {
      return {
        data: [
          { name: "views", total_value: { value: 92000 } },
          { name: "reach", total_value: { value: 41000 } },
          { name: "likes", total_value: { value: 5300 } },
        ],
      };
    }
    if (path === "profile/insights" && params.metric === "follower_count") {
      return {
        data: [{
          name: "follower_count",
          values: [
            { value: 12, end_time: "2026-11-12T08:00:00+0000" },
            { value: 18, end_time: "2026-11-13T08:00:00+0000" },
          ],
        }],
      };
    }
    throw new Error("unexpected");
  });
  const overview = await readAccountOverview("profile", graph);
  expect(overview.profile).toMatchObject({
    username: "avanca.oficial",
    followers_count: 15420,
    follows_count: 310,
    media_count: 88,
  });
  expect(overview.insights).toMatchObject({
    views: 92000,
    reach: 41000,
    likes: 5300,
    new_followers: 30,
  });
  expect(normalizeTimestamp("2026-11-13T08:00:00+0000")).toBe("2026-11-13T08:00:00.000Z");
});
