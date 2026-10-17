import type { SupabaseClient } from "npm:@supabase/supabase-js@2.98.0";
import {
  decrypt,
  encrypt,
  encryptionKey,
  randomSecret,
  secretsEqual,
  sha256,
} from "../google-calendar/crypto.ts";
import {
  TikTokError,
  uuid,
  validatePost,
  checkCreator,
  photoPayload,
} from "./model.ts";
import { tokens, tiktok, SCOPES } from "./tiktok-api.ts";
import type { Tokens } from "./tiktok-api.ts";
export interface Config {
  appUrl?: string;
  supabaseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  encryptionKey?: string;
  workerSecret?: string;
}
export function createTikTokHandler(
  db: SupabaseClient,
  config: Config,
  fetcher: typeof fetch = fetch,
) {
  const app = config.appUrl ? new URL(config.appUrl) : null;
  const ready = !!(
    app &&
    config.supabaseUrl &&
    config.clientId &&
    config.clientSecret &&
    config.encryptionKey &&
    config.workerSecret
  );
  const callback = `${config.supabaseUrl}/functions/v1/tiktok-publisher`;
  function checked<T>(r: { data: T; error: unknown }): T {
    if (r.error) throw new TikTokError("storage_failed", 500);
    return r.data;
  }
  async function credentials(value: Tokens, user: string) {
    return {
      credentials: await encrypt(
        JSON.stringify(value),
        await encryptionKey(config.encryptionKey!),
        user,
      ),
      expires_at: new Date(Date.now() + value.expires_in * 1000).toISOString(),
      reconnect_required: false,
    };
  }
  async function account(id: unknown, user: string) {
    if (!uuid(id)) throw new TikTokError("invalid_account");
    const a = checked(
      await db
        .from("tiktok_accounts")
        .select("*")
        .eq("id", id)
        .eq("user_id", user)
        .maybeSingle(),
    );
    if (!a) throw new TikTokError("account_missing", 404);
    return a;
  }
  async function lock<T>(id: string, run: () => Promise<T>): Promise<T> {
    const token = crypto.randomUUID();
    if (
      !checked(
        await db.rpc("tiktok_claim_account", { p_id: id, p_token: token }),
      )
    )
      throw new TikTokError("account_busy", 409);
    try {
      return await run();
    } finally {
      checked(
        await db.rpc("tiktok_release_account", { p_id: id, p_token: token }),
      );
    }
  }
  async function access(a: Record<string, any>): Promise<string> {
    a = await account(a.id, a.user_id);
    if (a.reconnect_required || !a.credentials)
      throw new TikTokError("reconnect_required", 401);
    try {
      let value: Tokens = JSON.parse(
        await decrypt(
          a.credentials,
          await encryptionKey(config.encryptionKey!),
          a.user_id,
        ),
      );
      if (Date.parse(a.expires_at) < Date.now() + 60000) {
        value = await tokens(
          fetcher,
          config.clientId!,
          config.clientSecret!,
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: value.refresh_token,
          }),
        );
        checked(
          await db
            .from("tiktok_accounts")
            .update(await credentials(value, a.user_id))
            .eq("id", a.id),
        );
      }
      return value.access_token;
    } catch (e) {
      if (e instanceof TikTokError && e.code === "reconnect_required")
        checked(
          await db
            .from("tiktok_accounts")
            .update({ reconnect_required: true })
            .eq("id", a.id),
        );
      throw e;
    }
  }
  async function revoke(a: Record<string, any>) {
    if (!a.credentials) return;
    try {
      const value: Tokens = JSON.parse(
        await decrypt(
          a.credentials,
          await encryptionKey(config.encryptionKey!),
          a.user_id,
        ),
      );
      await fetcher("https://open.tiktokapis.com/v2/oauth/revoke/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: config.clientId!,
          client_secret: config.clientSecret!,
          token: value.access_token,
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      /* Local removal still stops publishing; user can revoke in TikTok too. */
    }
  }
  async function processQueue() {
    const due = checked(await db.rpc("tiktok_due_accounts"));
    const deadline = Date.now() + 90000;
    let processed = 0;
    for (const row of due ?? []) {
      if (Date.now() + 35000 > deadline) break;
      try {
        await lock(row.account_id, async () => {
          const a = await account(row.account_id, row.user_id);
          if (a.paused || a.reconnect_required) return;
          const token = await access(a);
          const pending = checked(
            await db
              .from("tiktok_posts")
              .select("*")
              .eq("account_id", a.id)
              .eq("status", "submitted")
              .order("started_at")
              .limit(2),
          );
          for (const post of pending ?? []) {
            if (Date.now() + 35000 > deadline) break;
            try {
              const s = await tiktok(
                fetcher,
                token,
                "/post/publish/status/fetch/",
                { publish_id: post.publish_id },
              );
              if (s.status === "PUBLISH_COMPLETE") {
                const id = s.publicaly_available_post_id?.[0];
                checked(
                  await db
                    .from("tiktok_posts")
                    .update({
                      status: "published",
                      published_at: new Date().toISOString(),
                      tiktok_post_id: id ? String(id) : null,
                      error_code: null,
                    })
                    .eq("id", post.id)
                    .eq("status", "submitted"),
                );
              } else if (s.status === "FAILED")
                checked(
                  await db
                    .from("tiktok_posts")
                    .update({
                      status: "failed",
                      error_code: String(
                        s.fail_reason || "publish_failed",
                      ).slice(0, 100),
                    })
                    .eq("id", post.id)
                    .eq("status", "submitted"),
                );
            } catch (error) {
              // Revoked access must stop the account without losing publish_id.
              if (error instanceof TikTokError && error.code === "reconnect_required") {
                checked(await db.from("tiktok_accounts").update({ reconnect_required: true }).eq("id", a.id));
                return;
              }
              /* Keep publish_id; poll again, never submit this post again. */
            }
          }
          if (Date.now() + 35000 > deadline) return;
          const job = checked(
            await db
              .from("tiktok_posts")
              .select("*")
              .eq("account_id", a.id)
              .eq("status", "scheduled")
              .lte("scheduled_at", new Date().toISOString())
              .order("scheduled_at")
              .limit(1)
              .maybeSingle(),
          );
          if (!job) return;
          const claimed = checked(
            await db
              .from("tiktok_posts")
              .update({
                status: "processing",
                started_at: new Date().toISOString(),
                error_code: null,
              })
              .eq("id", job.id)
              .eq("status", "scheduled")
              .select("id")
              .maybeSingle(),
          );
          if (!claimed) return;
          let sent = false;
          try {
            const creator = await tiktok(
              fetcher,
              token,
              "/post/publish/creator_info/query/",
              {},
            );
            checkCreator(job.settings, creator);
            const urls = job.media.map(
              (m: { path: string }) =>
                `${app!.origin}/api/tiktok-media?path=${encodeURIComponent(m.path)}`,
            );
            sent = true;
            const result = await tiktok(
              fetcher,
              token,
              "/post/publish/content/init/",
              photoPayload(job.settings, urls),
            );
            if (typeof result.publish_id !== "string" || !result.publish_id)
              throw new Error("missing_publish_id");
            checked(
              await db
                .from("tiktok_posts")
                .update({ status: "submitted", publish_id: result.publish_id })
                .eq("id", job.id),
            );
            processed++;
          } catch (e) {
            const uncertain =
              sent &&
              (!(e instanceof TikTokError) || e.code === "storage_failed");
            checked(
              await db
                .from("tiktok_posts")
                .update({
                  status: uncertain ? "uncertain" : "failed",
                  error_code: uncertain
                    ? "confirmation_required"
                    : e instanceof TikTokError
                      ? e.code
                      : "publish_failed",
                })
                .eq("id", job.id),
            );
            if (e instanceof TikTokError && e.code === "reconnect_required")
              checked(
                await db
                  .from("tiktok_accounts")
                  .update({ reconnect_required: true })
                  .eq("id", a.id),
              );
          }
        });
      } catch {
        console.error("tiktok_worker_account_failed");
      }
    }
    return { processed };
  }
  return async (request: Request): Promise<Response> => {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": app?.origin ?? "null",
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    };
    const reply = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers });
    try {
      if (request.method === "OPTIONS")
        return new Response(null, { status: 204, headers });
      if (request.method === "GET") {
        if (!ready) throw new TikTokError("not_configured", 503);
        const url = new URL(request.url),
          dest = new URL("/tiktok", app!);
        dest.hash = new URLSearchParams(
          url.searchParams.has("error")
            ? { tt_error: "oauth_denied" }
            : {
                tt_code: url.searchParams.get("code") || "",
                tt_state: url.searchParams.get("state") || "",
              },
        ).toString();
        return new Response(null, {
          status: 303,
          headers: {
            Location: dest.toString(),
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      }
      if (request.method !== "POST")
        return reply({ error: "method_not_allowed" }, 405);
      if (
        request.headers.get("Origin") &&
        request.headers.get("Origin") !== app?.origin
      )
        throw new TikTokError("origin_denied", 403);
      if (Number(request.headers.get("Content-Length") || 0) > 32768)
        throw new TikTokError("invalid_request", 413);
      const raw = await request.text();
      if (raw.length > 32768) throw new TikTokError("invalid_request", 413);
      let p: Record<string, unknown>;
      try {
        p = JSON.parse(raw);
      } catch {
        throw new TikTokError("invalid_request");
      }
      if (!p || typeof p !== "object" || Array.isArray(p))
        throw new TikTokError("invalid_request");
      if (p.action === "process") {
        if (
          !config.workerSecret ||
          !(await secretsEqual(
            request.headers.get("X-Worker-Secret") || "",
            config.workerSecret,
          ))
        )
          throw new TikTokError("unauthorized", 401);
        if (!ready) throw new TikTokError("not_configured", 503);
        return reply(await processQueue());
      }
      const auth = await db.auth.getUser(
        request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "",
      );
      const user = auth.error ? null : auth.data.user?.id;
      if (!user) throw new TikTokError("unauthorized", 401);
      if (p.action === "list") {
        if (!ready)
          return reply({ configured: false, accounts: [], posts: [] });
        const accounts = checked(
          await db
            .from("tiktok_accounts")
            .select("id,username,name,paused,reconnect_required")
            .eq("user_id", user)
            .order("created_at"),
        );
        const posts = checked(
          await db
            .from("tiktok_posts")
            .select(
              "id,account_id,settings,media,scheduled_at,status,tiktok_post_id,error_code,published_at",
            )
            .eq("user_id", user)
            .order("created_at", { ascending: false })
            .range(0, 199),
        );
        return reply({ configured: true, accounts, posts });
      }
      if (!ready) throw new TikTokError("not_configured", 503);
      if (p.action === "connect") {
        const state = randomSecret();
        checked(
          await db.from("tiktok_oauth_states").delete().eq("user_id", user),
        );
        checked(
          await db
            .from("tiktok_oauth_states")
            .insert({
              state_hash: await sha256(state),
              user_id: user,
              expires_at: new Date(Date.now() + 600000).toISOString(),
            }),
        );
        const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
        url.search = new URLSearchParams({
          client_key: config.clientId!,
          response_type: "code",
          scope: SCOPES,
          redirect_uri: callback,
          state,
          disable_auto_auth: "1",
        }).toString();
        return reply({ url: url.toString() });
      }
      if (p.action === "callback") {
        if (
          typeof p.state !== "string" ||
          p.state.length > 256 ||
          typeof p.code !== "string" ||
          p.code.length > 4096
        )
          throw new TikTokError("oauth_state_invalid");
        const state = checked(
          await db
            .from("tiktok_oauth_states")
            .delete()
            .eq("state_hash", await sha256(p.state))
            .eq("user_id", user)
            .gt("expires_at", new Date().toISOString())
            .select()
            .maybeSingle(),
        );
        if (!state) throw new TikTokError("oauth_state_invalid");
        const value = await tokens(
          fetcher,
          config.clientId!,
          config.clientSecret!,
          new URLSearchParams({
            grant_type: "authorization_code",
            code: p.code,
            redirect_uri: callback,
          }),
        );
        if (!value.scope?.split(",").includes(SCOPES))
          throw new TikTokError("permission_required");
        const creator = await tiktok(
          fetcher,
          value.access_token,
          "/post/publish/creator_info/query/",
          {},
        );
        if (typeof creator.creator_nickname !== "string")
          throw new TikTokError("tiktok_unavailable");
        const existing = checked(
          await db
            .from("tiktok_accounts")
            .select("id")
            .eq("user_id", user)
            .eq("tiktok_user_id", value.open_id)
            .maybeSingle(),
        );
        const save = async () => {
          checked(
            await db
              .from("tiktok_accounts")
              .upsert(
                {
                  user_id: user,
                  tiktok_user_id: value.open_id,
                  username:
                    creator.creator_username || creator.creator_nickname,
                  name: creator.creator_nickname,
                  ...(await credentials(value, user)),
                },
                { onConflict: "user_id,tiktok_user_id" },
              ),
          );
        };
        if (existing) await lock(existing.id, save);
        else await save();
        return reply({ success: true });
      }
      if (p.action === "creator") {
        const a = await account(p.accountId, user);
        return reply(
          await lock(a.id, async () => {
            const c = await tiktok(
              fetcher,
              await access(a),
              "/post/publish/creator_info/query/",
              {},
            );
            return {
              creator_nickname: c.creator_nickname,
              creator_username: c.creator_username,
              privacy_level_options: c.privacy_level_options,
              comment_disabled: c.comment_disabled,
            };
          }),
        );
      }
      if (p.action === "schedule") {
        if (uuid(p.id)) {
          const prior = checked(
            await db
              .from("tiktok_posts")
              .select("id,user_id")
              .eq("id", p.id)
              .maybeSingle(),
          );
          if (prior) {
            if (prior.user_id !== user) throw new TikTokError("invalid_post");
            return reply({ success: true, id: prior.id });
          }
        }
        const input = validatePost(p, user);
        const a = await account(input.accountId, user);
        return reply(
          await lock(a.id, async () => {
            const existing = checked(
              await db
                .from("tiktok_posts")
                .select("id,user_id")
                .eq("id", input.id)
                .maybeSingle(),
            );
            if (existing) {
              if (existing.user_id !== user)
                throw new TikTokError("invalid_post");
              return { success: true, id: existing.id };
            }
            if (a.paused) throw new TikTokError("account_paused");
            const creator = await tiktok(
              fetcher,
              await access(a),
              "/post/publish/creator_info/query/",
              {},
            );
            checkCreator(input.settings, creator);
            await Promise.all(
              input.media.map(async (m) => {
                const filename = m.path.split("/")[1];
                const objects = checked(
                  await db.storage
                    .from("tiktok-media")
                    .list(user, { search: filename, limit: 1 }),
                );
                const o = objects?.find(
                  (v: { name: string }) => v.name === filename,
                );
                if (
                  !o ||
                  o.metadata?.mimetype !== m.type ||
                  !Number(o.metadata?.size) ||
                  Number(o.metadata?.size) > 4194304
                )
                  throw new TikTokError("invalid_media");
              }),
            );
            checked(
              await db
                .from("tiktok_posts")
                .insert({
                  id: input.id,
                  user_id: user,
                  account_id: a.id,
                  settings: input.settings,
                  media: input.media,
                  scheduled_at: input.scheduledAt,
                  consent_at: new Date().toISOString(),
                }),
            );
            return { success: true, id: input.id };
          }),
        );
      }
      if (p.action === "cancel") {
        if (!uuid(p.id)) throw new TikTokError("invalid_post");
        const row = checked(
          await db
            .from("tiktok_posts")
            .update({ status: "cancelled" })
            .eq("id", p.id)
            .eq("user_id", user)
            .eq("status", "scheduled")
            .select("id")
            .maybeSingle(),
        );
        if (!row) throw new TikTokError("post_changed", 409);
        return reply({ success: true });
      }
      if (p.action === "pause" || p.action === "disconnect") {
        const a = await account(p.accountId, user);
        return reply(
          await lock(a.id, async () => {
            if (p.action === "pause") {
              if (typeof p.paused !== "boolean")
                throw new TikTokError("invalid_request");
              checked(
                await db
                  .from("tiktok_accounts")
                  .update({ paused: p.paused })
                  .eq("id", a.id),
              );
            } else {
              await revoke(a);
              checked(
                await db
                  .from("tiktok_accounts")
                  .update({
                    paused: true,
                    reconnect_required: true,
                    credentials: "",
                  })
                  .eq("id", a.id),
              );
            }
            return { success: true };
          }),
        );
      }
      if (p.action === "delete_data") {
        if (p.confirm !== "EXCLUIR")
          throw new TikTokError("confirmation_required");
        const rows = checked(
          await db.from("tiktok_accounts").select("*").eq("user_id", user),
        );
        for (const a of rows ?? [])
          await lock(a.id, async () => {
            // An in-flight publication cannot be recalled; show this warning before deletion.
            await revoke(a);
            checked(
              await db
                .from("tiktok_accounts")
                .delete()
                .eq("id", a.id)
                .eq("user_id", user),
            );
          });
        checked(
          await db.from("tiktok_oauth_states").delete().eq("user_id", user),
        );
        for (;;) {
          const files = checked(
            await db.storage.from("tiktok-media").list(user, { limit: 100 }),
          );
          if (!files?.length) break;
          checked(
            await db.storage
              .from("tiktok-media")
              .remove(files.map((f: { name: string }) => `${user}/${f.name}`)),
          );
        }
        return reply({ success: true });
      }
      throw new TikTokError("invalid_action");
    } catch (e) {
      if (e instanceof TikTokError) return reply({ error: e.code }, e.status);
      console.error("tiktok_request_failed");
      return reply({ error: "request_failed" }, 500);
    }
  };
}
