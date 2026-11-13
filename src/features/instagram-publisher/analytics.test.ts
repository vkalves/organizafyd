import { describe, expect, it, vi } from "vitest";
import { readVideoAnalytics } from "../../../supabase/functions/instagram-publisher/analytics";
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
    const graph = vi.fn(async () => ({
      data: [],
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
      timestamp: "2026-11-13",
      insights: {
        data: [{ name: "views", total_value: { value: 1234 } }, {
          name: "likes",
          values: [{ value: 56 }],
        }],
      },
    }],
  }));
  const result = await readVideoAnalytics("owner", "profile", graph);
  expect(result.videos[0]).toMatchObject({ views: 1234, likes: 56 });
  expect(result.insights_error).toBeNull();
  expect(graph).toHaveBeenCalledTimes(1);
  expect(graph).toHaveBeenCalledWith(
    "profile/media",
    expect.objectContaining({
      fields: expect.stringContaining("insights.metric(views,likes)"),
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
