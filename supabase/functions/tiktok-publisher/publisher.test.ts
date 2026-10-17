import { describe, it, expect, vi } from "vitest";
import {
  validatePost,
  validateSettings,
  checkCreator,
  photoPayload,
} from "./model.ts";
import { createTikTokHandler } from "./handler.ts";
import { tokens, tiktok } from "./tiktok-api.ts";
const user = "11111111-1111-1111-1111-111111111111";
const accountId = "22222222-2222-2222-2222-222222222222";
const settings = {
  title: "Fotos",
  description: "Descrição",
  privacy: "SELF_ONLY",
  comments: false,
  music: false,
  commercial: false,
  ownBrand: false,
  branded: false,
  ai: false,
  cover: 0,
};
const valid = {
  id: crypto.randomUUID(),
  accountId,
  settings,
  consent: true,
  media: [{ path: `${user}/${crypto.randomUUID()}.jpg`, type: "image/jpeg" }],
  scheduledAt: new Date(Date.now() + 120000).toISOString(),
};
const config = {
  appUrl: "https://www.organizafy.site",
  supabaseUrl: "https://project.supabase.co",
  clientId: "client",
  clientSecret: "secret",
  encryptionKey: btoa("a".repeat(32)),
  workerSecret: "a-test-worker-secret-longer-than-thirty-two",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
describe("photo authorization and settings", () => {
  it("requires express consent, a valid future date, and owned immutable paths", () => {
    expect(() => validatePost({ ...valid, consent: false }, user)).toThrow(
      "consent_required",
    );
    expect(() =>
      validatePost({ ...valid, scheduledAt: new Date(0).toISOString() }, user),
    ).toThrow("invalid_date");
    for (const path of [
      `${accountId}/${crypto.randomUUID()}.jpg`,
      `${user}/../a.jpg`,
      "https://evil.example/a.jpg",
    ])
      expect(() =>
        validatePost({ ...valid, media: [{ path, type: "image/jpeg" }] }, user),
      ).toThrow("invalid_media");
  });
  it("rejects invalid count, duplicate files, unsupported media and invalid cover", () => {
    for (const media of [
      [],
      Array(36).fill(valid.media[0]),
      [valid.media[0], valid.media[0]],
      [{ ...valid.media[0], type: "video/mp4" }],
    ])
      expect(() => validatePost({ ...valid, media }, user)).toThrow(
        "invalid_media",
      );
    expect(() =>
      validatePost({ ...valid, settings: { ...settings, cover: 1 } }, user),
    ).toThrow("invalid_media");
  });
  it("requires manual privacy, disclosure detail, and compatible branded visibility", () => {
    expect(() => validateSettings({ ...settings, privacy: "" })).toThrow(
      "invalid_settings",
    );
    expect(() => validateSettings({ ...settings, commercial: true })).toThrow(
      "commercial_required",
    );
    expect(() =>
      validateSettings({ ...settings, commercial: true, branded: true }),
    ).toThrow("invalid_settings");
    expect(() =>
      checkCreator(settings, { privacy_level_options: ["PUBLIC_TO_EVERYONE"] }),
    ).toThrow("settings_changed");
    expect(() =>
      checkCreator(
        { ...settings, comments: true },
        { privacy_level_options: ["SELF_ONLY"], comment_disabled: true },
      ),
    ).toThrow("settings_changed");
  });
  it("preserves order, cover, explicit privacy, AI and commercial flags in the real photo payload", () => {
    const p = photoPayload({ ...settings, cover: 1, ai: true, music: true }, [
      "https://host/one",
      "https://host/two",
    ]);
    expect(p.source_info.photo_images).toEqual([
      "https://host/one",
      "https://host/two",
    ]);
    expect(p.source_info.photo_cover_index).toBe(1);
    expect(p.is_aigc).toBe(true);
    expect(p.post_info.privacy_level).toBe("SELF_ONLY");
    expect(p.post_info.disable_comment).toBe(true);
    expect(p.media_type).toBe("PHOTO");
    expect(validatePost(valid, user).accountId).toBe(accountId);
  });
});
describe("TikTok transport", () => {
  it("never retries ambiguous initialization or falsely marks it published", async () => {
    for (const response of [
      () => Promise.reject(new Error("timeout")),
      () => Promise.resolve(json({}, 503)),
      () => Promise.resolve(json({ unexpected: true })),
    ]) {
      const f = vi.fn(response);
      await expect(
        tiktok(f, "token", "/post/publish/content/init/", {}),
      ).rejects.toThrow();
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
  it("uses rotated refresh credentials from the official endpoint", async () => {
    const f = vi.fn(async () =>
      json({
        access_token: "new",
        refresh_token: "rotated",
        expires_in: 86400,
        open_id: "creator",
        scope: "video.publish",
      }),
    );
    expect(
      (
        await tokens(
          f,
          "client",
          "secret",
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: "old",
          }),
        )
      ).refresh_token,
    ).toBe("rotated");
    const [url, request] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    expect(
      new URLSearchParams(request.body as string).get("client_secret"),
    ).toBe("secret");
  });
  it("does not leak an upstream credential or error detail", async () => {
    await expect(
      tiktok(
        vi.fn(async () =>
          json(
            {
              error: {
                code: "access_token_invalid",
                message: "sensitive-token",
              },
            },
            401,
          ),
        ),
        "token",
        "/x",
        {},
      ),
    ).rejects.toThrow("reconnect_required");
  });
});
function setup(authenticated = false) {
  const db = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: authenticated ? { id: user } : null },
        error: !authenticated,
      })),
    },
    from: vi.fn(),
    rpc: vi.fn(),
  };
  const fetcher = vi.fn();
  const handler = createTikTokHandler(db as never, config, fetcher);
  const request = (p: unknown, headers: Record<string, string> = {}) =>
    handler(
      new Request(config.supabaseUrl + "/functions/v1/tiktok-publisher", {
        method: "POST",
        headers,
        body: JSON.stringify(p),
      }),
    );
  return { db, fetcher, handler, request };
}
describe("access isolation", () => {
  it("rejects unauthenticated actions and worker calls without the worker secret", async () => {
    const { db, request } = setup();
    expect((await request({ action: "schedule", ...valid })).status).toBe(401);
    expect((await request({ action: "process" })).status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("rejects foreign browser origins before database access", async () => {
    const { db, request } = setup(true);
    expect(
      (await request({ action: "connect" }, { Origin: "https://evil.example" }))
        .status,
    ).toBe(403);
    expect(db.auth.getUser).not.toHaveBeenCalled();
  });
  it("uses only the configured callback destination and no tokens in query strings", async () => {
    const { handler } = setup();
    const r = await handler(
      new Request(
        config.supabaseUrl +
          "/functions/v1/tiktok-publisher?code=abc&state=xyz&redirect=https://evil.example",
      ),
    );
    const u = new URL(r.headers.get("Location")!);
    expect(u.origin).toBe(config.appUrl);
    expect(u.pathname).toBe("/tiktok");
    expect(u.search).toBe("");
    expect(new URLSearchParams(u.hash.slice(1)).get("tt_code")).toBe("abc");
  });
  it("will not operate on an account belonging to another user", async () => {
    const { db, request, fetcher } = setup(true);
    const filters: unknown[] = [];
    const q = {
      select: () => q,
      eq: (...p: unknown[]) => {
        filters.push(p);
        return q;
      },
      maybeSingle: async () => ({ data: null, error: null }),
    };
    db.from.mockReturnValue(q);
    expect((await request({ action: "disconnect", accountId })).status).toBe(
      404,
    );
    expect(filters).toContainEqual(["user_id", user]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not consume another owner’s OAuth state", async () => {
    const { db, request, fetcher } = setup(true);
    const filters: unknown[] = [];
    const q = {
      delete: () => q,
      eq: (...p: unknown[]) => {
        filters.push(p);
        return q;
      },
      gt: () => q,
      select: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    db.from.mockReturnValue(q);
    const r = await request({
      action: "callback",
      code: "abc",
      state: "another-owner",
    });
    expect((await r.json()).error).toBe("oauth_state_invalid");
    expect(filters).toContainEqual(["user_id", user]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

import { encrypt, encryptionKey } from "../google-calendar/crypto.ts";
async function workerSetup(fetcher: typeof fetch) {
  const a = {
    id: accountId,
    user_id: user,
    paused: false,
    reconnect_required: false,
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    credentials: await encrypt(
      JSON.stringify({ access_token: "token", refresh_token: "refresh" }),
      await encryptionKey(config.encryptionKey),
      user,
    ),
  };
  const posts = [
    {
      ...valid,
      account_id: accountId,
      user_id: user,
      status: "scheduled",
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
      started_at: null,
      publish_id: null,
      error_code: null,
    },
  ];
  const records: Record<string, any[]> = {
    tiktok_accounts: [a],
    tiktok_posts: posts,
  };
  const db = {
    rpc: vi.fn(async (name: string) => ({
      data:
        name === "tiktok_due_accounts"
          ? [{ account_id: accountId, user_id: user }]
          : true,
      error: null,
    })),
    from: (table: string) => {
      let filters: Array<(r: any) => boolean> = [],
        patch: Record<string, unknown> | null = null,
        max = Infinity;
      function run(single = false) {
        let rows = (records[table] || [])
          .filter((r) => filters.every((f) => f(r)))
          .slice(0, max);
        if (patch) rows.forEach((r) => Object.assign(r, patch));
        return { data: single ? rows[0] || null : rows, error: null };
      }
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters.push((r) => r[k] === v);
          return q;
        },
        lte: (k: string, v: string) => {
          filters.push((r) => r[k] <= v);
          return q;
        },
        order: () => q,
        limit: (n: number) => {
          max = n;
          return q;
        },
        update: (v: Record<string, unknown>) => {
          patch = v;
          return q;
        },
        maybeSingle: async () => run(true),
        then: (resolve: (r: unknown) => void) =>
          Promise.resolve(run()).then(resolve),
      };
      return q;
    },
  };
  const handler = createTikTokHandler(db as never, config, fetcher);
  const process = () =>
    handler(
      new Request(config.supabaseUrl + "/functions/v1/tiktok-publisher", {
        method: "POST",
        headers: { "X-Worker-Secret": config.workerSecret },
        body: JSON.stringify({ action: "process" }),
      }),
    );
  return { posts, process };
}
describe("worker outcome safety", () => {
  it("stores the publish ID, polls to completion, and never resubmits accepted content", async () => {
    let completed = false;
    const f = vi.fn(async (url: string) =>
      url.endsWith("creator_info/query/")
        ? json({
            error: { code: "ok" },
            data: { privacy_level_options: ["SELF_ONLY"] },
          })
        : url.endsWith("content/init/")
          ? json({ error: { code: "ok" }, data: { publish_id: "publish-1" } })
          : json({
              error: { code: "ok" },
              data: {
                status: completed ? "PUBLISH_COMPLETE" : "PROCESSING_DOWNLOAD",
              },
            }),
    );
    const { posts, process } = await workerSetup(f as typeof fetch);
    expect((await process()).status).toBe(200);
    expect(posts[0].status).toBe("submitted");
    expect(posts[0].publish_id).toBe("publish-1");
    await process();
    expect(posts[0].status).toBe("submitted");
    completed = true;
    await process();
    expect(posts[0].status).toBe("published");
    expect(
      f.mock.calls.filter((c) => c[0].endsWith("content/init/")),
    ).toHaveLength(1);
  });
  it("quarantines an ambiguous initialization instead of sending it again", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.endsWith("creator_info/query/"))
        return json({
          error: { code: "ok" },
          data: { privacy_level_options: ["SELF_ONLY"] },
        });
      throw new Error("connection lost");
    });
    const { posts, process } = await workerSetup(f as typeof fetch);
    await process();
    expect(posts[0].status).toBe("uncertain");
    await process();
    expect(
      f.mock.calls.filter((c) => c[0].endsWith("content/init/")),
    ).toHaveLength(1);
  });
});
