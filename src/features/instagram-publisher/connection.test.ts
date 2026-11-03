import { describe, it, expect, vi } from "vitest";
import {
  connectionInput,
  checkProfile,
  discoverProfiles,
} from "../../../supabase/functions/instagram-publisher/connection";
describe("account connection", () => {
  it("rejects empty credentials and non-numeric Graph paths", () => {
    expect(() => connectionInput(" ")).toThrow("invalid_connection");
    expect(() => connectionInput("token", "me/accounts")).toThrow(
      "invalid_instagram_id",
    );
    expect(connectionInput(" token ", "17841424681276959")).toBe("token");
  });
  it("follows fixed-path cursors and deduplicates profiles without returning secrets", async () => {
    const graph = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            access_token: "secret",
            instagram_business_account: { id: "12345", username: "one" },
          },
        ],
        paging: {
          next: "https://untrusted.example",
          cursors: { after: "cursor" },
        },
      })
      .mockResolvedValueOnce({
        data: [
          { instagram_business_account: { id: "12345", username: "one" } },
          { id: "no_ig" },
          { instagram_business_account: { id: "67890", username: "two" } },
        ],
      });
    expect(await discoverProfiles(graph, "token")).toEqual([
      { id: "12345", username: "one" },
      { id: "67890", username: "two" },
    ]);
    expect(graph.mock.calls[1][0]).toBe("me/accounts");
    expect(graph.mock.calls[1][2].after).toBe("cursor");
  });
  it("rejects tokens without publishing permission", async () => {
    const graph = vi
      .fn()
      .mockResolvedValue({
        data: [{ permission: "instagram_basic", status: "granted" }],
      });
    await expect(checkProfile(graph, "token", "12345")).rejects.toThrow(
      "missing_publish_permission",
    );
    expect(graph).toHaveBeenCalledTimes(1);
  });
  it("verifies exact profile and publishing access without creating media", async () => {
    const graph = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          { permission: "instagram_basic", status: "granted" },
          { permission: "instagram_content_publish", status: "granted" },
        ],
      })
      .mockResolvedValueOnce({
        id: "12345",
        username: "one",
        access_token: "never_return",
      })
      .mockResolvedValueOnce({ data: [{ quota_usage: 0 }] });
    expect(await checkProfile(graph, "token", "12345")).toEqual({
      id: "12345",
      username: "one",
    });
    expect(graph.mock.calls.map((c) => c[0])).toEqual([
      "me/permissions",
      "12345",
      "12345/content_publishing_limit",
    ]);
  });
});
