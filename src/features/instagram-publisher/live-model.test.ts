import { describe, it, expect } from "vitest";
import {
  validate,
  mediaParams,
} from "../../../supabase/functions/instagram-publisher/model";
const user = "1a7652be-b8f0-429c-96b7-ce8dbcddb4b0";
const base = {
  id: "00000000-0000-4000-8000-000000000001",
  account_id: "00000000-0000-4000-8000-000000000002",
  caption: "Teste",
  format: "Feed" as const,
  media_urls: ["https://example.com/a.jpg"],
  scheduled_at: "2030-01-01T12:00:00Z",
};
describe("Live publication validation", () => {
  it("requires future schedule, media and valid format", () => {
    expect(() => validate(base, user)).not.toThrow();
    expect(() => validate({ ...base, scheduled_at: null }, user)).toThrow(
      "invalid_schedule",
    );
    expect(() =>
      validate({ ...base, scheduled_at: "2020-01-01" }, user),
    ).toThrow("invalid_schedule");
    expect(() => validate({ ...base, media_urls: [] }, user)).toThrow(
      "invalid_media",
    );
  });
  it("rejects another owner’s stored files and non-HTTPS URLs", () => {
    expect(() =>
      validate({ ...base, media_urls: ["storage://" + user + "/a.jpg"] }, user),
    ).not.toThrow();
    expect(() =>
      validate({ ...base, media_urls: ["storage://other/a.jpg"] }, user),
    ).toThrow("invalid_media_owner");
    expect(() =>
      validate(
        { ...base, media_urls: ["storage://" + user + "/../a.jpg"] },
        user,
      ),
    ).toThrow();
    for (const url of [
      "http://example.com/a.jpg",
      "javascript:alert(1)",
      "https://a:b@example.com/a.jpg",
    ])
      expect(() => validate({ ...base, media_urls: [url] }, user)).toThrow();
  });
  it("rejects unsupported media combinations before scheduling", () => {
    expect(() => validate({ ...base, format: "Reel" }, user)).toThrow(
      "invalid_media_format",
    );
    expect(() =>
      validate(
        { ...base, format: "Reel", media_urls: ["https://example.com/a.mp4"] },
        user,
      ),
    ).not.toThrow();
    expect(() => validate({ ...base, format: "Carrossel" }, user)).toThrow(
      "invalid_media",
    );
    expect(() =>
      validate(
        {
          ...base,
          format: "Carrossel",
          media_urls: Array(11).fill(base.media_urls[0]),
        },
        user,
      ),
    ).toThrow();
  });
  it("builds the correct Meta container fields for photos, reels and stories", () => {
    expect(mediaParams("Feed", "https://signed/a", "storage://a.jpg")).toEqual({
      image_url: "https://signed/a",
    });
    expect(mediaParams("Reel", "https://signed/a", "storage://a.mp4")).toEqual({
      media_type: "REELS",
      video_url: "https://signed/a",
      share_to_feed: "true",
    });
    expect(mediaParams("Story", "https://signed/a", "storage://a.mp4")).toEqual(
      { media_type: "STORIES", video_url: "https://signed/a" },
    );
  });
});
