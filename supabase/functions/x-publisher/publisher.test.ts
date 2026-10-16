import { describe, it, expect, vi } from "vitest";
import { validatePost, textWeight } from "./model.ts";
import { publish, tokens, uploadMedia } from "./x-api.ts";
import { createXHandler } from "./handler.ts";
const user = "11111111-1111-1111-1111-111111111111";
const accountId = "22222222-2222-2222-2222-222222222222";
const valid = {
  id: crypto.randomUUID(),
  accountId,
  text: "Olá",
  media: [],
  scheduledAt: new Date(Date.now() + 120000).toISOString(),
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
describe("queue validation", () => {
  it("rejects another user’s media path and traversal", () => {
    for (const path of [
      `${accountId}/${crypto.randomUUID()}.jpg`,
      `${user}/../private.jpg`,
    ]) {
      expect(() =>
        validatePost(
          { ...valid, media: [{ path, type: "image/jpeg", name: "foto.jpg" }] },
          user,
        ),
      ).toThrow("invalid_media");
    }
  });
  it("rejects video mixed with photos and more than four attachments", () => {
    const m = {
      path: `${user}/${crypto.randomUUID()}.mp4`,
      type: "video/mp4",
      name: "a.mp4",
    };
    expect(() => validatePost({ ...valid, media: [m, m] }, user)).toThrow(
      "invalid_media",
    );
    expect(() =>
      validatePost(
        { ...valid, media: Array(5).fill({ ...m, type: "image/png" }) },
        user,
      ),
    ).toThrow("invalid_media");
  });
  it("rejects expired dates, empty posts, and oversized weighted text", () => {
    expect(() =>
      validatePost({ ...valid, scheduledAt: new Date(0).toISOString() }, user),
    ).toThrow("invalid_schedule");
    expect(() => validatePost({ ...valid, text: "  " }, user)).toThrow(
      "empty_post",
    );
    expect(() =>
      validatePost({ ...valid, text: "界".repeat(141) }, user),
    ).toThrow("invalid_text");
    expect(textWeight("https://example.com/" + "a".repeat(500))).toBe(23);
  });
  it("accepts a media-only post and keeps the requested account", () => {
    const post = validatePost(
      {
        ...valid,
        text: "",
        media: [
          {
            path: `${user}/${crypto.randomUUID()}.png`,
            type: "image/png",
            name: "foto.png",
          },
        ],
      },
      user,
    );
    expect(post.accountId).toBe(accountId);
  });
});
describe("X transport safety", () => {
  it("never retries ambiguous post creation", async () => {
    for (const failure of [
      () => Promise.reject(new Error("network")),
      () => Promise.resolve(json({}, 503)),
      () => Promise.resolve(json({ data: {} })),
    ]) {
      const fetcher = vi.fn(failure);
      await expect(publish(fetcher, "token", "post", [])).rejects.toThrow(
        "confirmation_required",
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("classifies confirmed rate and credit failures without exposing upstream data", async () => {
    for (const [status, code] of [
      [429, "rate_limited"],
      [402, "credits_required"],
      [401, "reconnect_required"],
    ] as const) {
      await expect(
        publish(
          vi.fn(async () => json({ secret: "do not expose" }, status)),
          "token",
          "post",
          [],
        ),
      ).rejects.toThrow(code);
    }
  });
  it("includes media IDs in the selected authenticated user context", async () => {
    const fetcher = vi.fn(async () => json({ data: { id: "123" } }));
    expect(await publish(fetcher, "account-token", "texto", ["456"])).toBe(
      "123",
    );
    const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(request[1].headers).toMatchObject({
      Authorization: "Bearer account-token",
    });
    expect(JSON.parse(request[1].body as string)).toEqual({
      text: "texto",
      media: { media_ids: ["456"] },
    });
  });
  it("refreshes through the official token endpoint with confidential client authentication", async () => {
    const fetcher = vi.fn(async () =>
      json({ access_token: "new", refresh_token: "rotated", expires_in: 7200 }),
    );
    const result = await tokens(
      fetcher,
      "client",
      "secret",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: "old",
      }),
    );
    expect(result.refresh_token).toBe("rotated");
    const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(request[0]).toBe("https://api.x.com/2/oauth2/token");
    expect(request[1].headers).toMatchObject({
      Authorization: `Basic ${btoa("client:secret")}`,
    });
  });
  it("uploads in order and waits for video processing before returning an ID", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ data: { id: "123" } }))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(
        json({ data: { id: "123", processing_info: { state: "succeeded" } } }),
      );
    expect(
      await uploadMedia(
        fetcher,
        "token",
        new Blob(["video"], { type: "video/mp4" }),
        Date.now() + 60000,
      ),
    ).toBe("123");
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
      "https://api.x.com/2/media/upload/initialize",
      "https://api.x.com/2/media/upload/123/append",
      "https://api.x.com/2/media/upload/123/finalize",
    ]);
  });
  it("does not publish failed media", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ data: { id: "123" } }))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(
        json({ data: { processing_info: { state: "failed" } } }),
      );
    await expect(
      uploadMedia(
        fetcher,
        "token",
        new Blob(["video"], { type: "video/mp4" }),
        Date.now() + 60000,
      ),
    ).rejects.toThrow("media_failed");
    expect(fetcher.mock.calls.every((c) => !c[0].endsWith("/tweets"))).toBe(
      true,
    );
  });
});
describe("handler access control", () => {
  const config = {
    appUrl: "https://www.organizafy.site",
    supabaseUrl: "https://project.supabase.co",
    clientId: "client",
    clientSecret: "secret",
    encryptionKey: btoa("a".repeat(32)),
    workerSecret: "worker-secret-at-least-thirty-two-characters",
  };
  function setup() {
    const db = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: true })),
      },
      from: vi.fn(),
      rpc: vi.fn(),
    };
    const handler = createXHandler(
      db as unknown as Parameters<typeof createXHandler>[0],
      config,
      vi.fn(),
    );
    const request = (payload: unknown, headers: Record<string, string> = {}) =>
      handler(
        new Request("https://project.supabase.co/functions/v1/x-publisher", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(payload),
        }),
      );
    return { db, handler, request };
  }
  it("rejects user actions without a verified login", async () => {
    const { db, request } = setup();
    expect((await request({ action: "schedule", ...valid })).status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("rejects worker invocation without its independent secret", async () => {
    const { db, request } = setup();
    expect(
      (
        await request(
          { action: "process" },
          { Authorization: "Bearer user-token" },
        )
      ).status,
    ).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("rejects another browser origin", async () => {
    const { db, request } = setup();
    expect(
      (await request({ action: "connect" }, { Origin: "https://evil.example" }))
        .status,
    ).toBe(403);
    expect(db.auth.getUser).not.toHaveBeenCalled();
  });
  it("redirects only to the configured site, puts callback data in the fragment", async () => {
    const { handler, db } = setup();
    const result = await handler(
      new Request(
        "https://project.supabase.co/functions/v1/x-publisher?code=abc&state=xyz&redirect=https://evil.example",
      ),
    );
    const location = new URL(result.headers.get("Location")!);
    expect(location.origin).toBe(config.appUrl);
    expect(location.pathname).toBe("/x");
    expect(location.search).toBe("");
    expect(new URLSearchParams(location.hash.slice(1)).get("x_code")).toBe(
      "abc",
    );
    expect(db.from).not.toHaveBeenCalled();
  });
  it("does not expose tables or credentials through list without server setup", async () => {
    const { db } = setup();
    db.auth.getUser.mockResolvedValue({
      data: { user: { id: user } },
      error: null,
    } as never);
    const handler = createXHandler(
      db as unknown as Parameters<typeof createXHandler>[0],
      { appUrl: config.appUrl },
    );
    const result = await handler(
      new Request("https://project.supabase.co/functions/v1/x-publisher", {
        method: "POST",
        body: JSON.stringify({ action: "list" }),
      }),
    );
    expect(await result.json()).toEqual({
      configured: false,
      accounts: [],
      posts: [],
    });
    expect(db.from).not.toHaveBeenCalled();
  });
});
