import type { SupabaseClient } from "npm:@supabase/supabase-js@2.98.0";
import {
  challenge,
  decrypt,
  encrypt,
  encryptionKey,
  randomSecret,
  secretsEqual,
  sha256,
} from "../google-calendar/crypto.ts";
import { validatePost, uuid, XError } from "./model.ts";
import type { Media } from "./model.ts";
import { SCOPES, tokens, xRequest, uploadMedia, publish } from "./x-api.ts";
import type { Tokens } from "./x-api.ts";
export interface Config {
  appUrl?: string;
  supabaseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  encryptionKey?: string;
  workerSecret?: string;
}
export function createXHandler(
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
  const callback = `${config.supabaseUrl}/functions/v1/x-publisher`;
  const publicAccountFields = "id,username,name,reconnect_required,paused";
  const postFields =
    "id,account_id,text,media,scheduled_at,status,x_post_id,error_code,published_at";
  function checked<T>(result: { data: T; error: unknown }): T {
    if (result.error) throw new XError("storage_failed", 500);
    return result.data;
  }
  async function credentials(value: Tokens, userId: string) {
    return {
      credentials: await encrypt(
        JSON.stringify(value),
        await encryptionKey(config.encryptionKey!),
        userId,
      ),
      expires_at: new Date(Date.now() + value.expires_in * 1000).toISOString(),
      reconnect_required: false,
    };
  }
  async function withLock<T>(id: string, action: () => Promise<T>): Promise<T> {
    const lock = crypto.randomUUID();
    if (!checked(await db.rpc("x_claim_account", { p_id: id, p_token: lock })))
      throw new XError("account_busy", 409);
    try {
      return await action();
    } finally {
      checked(await db.rpc("x_release_account", { p_id: id, p_token: lock }));
    }
  }
  async function account(id: unknown, user: string) {
    if (!uuid(id)) throw new XError("invalid_account");
    const row = checked(
      await db
        .from("x_accounts")
        .select("*")
        .eq("id", id)
        .eq("user_id", user)
        .maybeSingle(),
    );
    if (!row) throw new XError("account_missing", 404);
    return row;
  }
  async function processQueue() {
    const due = checked(await db.rpc("x_due_accounts"));
    const deadline = Date.now() + 90000;
    let processed = 0;
    const seen = new Set<string>();
    for (const row of due ?? []) {
      if (Date.now() + 25000 > deadline) break;
      if (seen.has(row.account_id)) continue;
      seen.add(row.account_id);
      try {
        await withLock(row.account_id, async () => {
          const a = await account(row.account_id, row.user_id);
          if (a.paused || a.reconnect_required) return;
          const job = checked(
            await db
              .from("x_posts")
              .select("*")
              .eq("account_id", a.id)
              .eq("status", "scheduled")
              .lte("scheduled_at", new Date().toISOString())
              .order("scheduled_at")
              .limit(1)
              .maybeSingle(),
          );
          if (!job) return;
          let token: Tokens;
          try {
            token = JSON.parse(
              await decrypt(
                a.credentials,
                await encryptionKey(config.encryptionKey!),
                a.user_id,
              ),
            );
            if (Date.parse(a.expires_at) < Date.now() + 60000) {
              token = await tokens(
                fetcher,
                config.clientId!,
                config.clientSecret!,
                new URLSearchParams({
                  grant_type: "refresh_token",
                  refresh_token: token.refresh_token,
                }),
              );
              checked(
                await db
                  .from("x_accounts")
                  .update(await credentials(token, a.user_id))
                  .eq("id", a.id),
              );
            }
          } catch (error) {
            if (error instanceof XError && error.code === "reconnect_required")
              checked(
                await db
                  .from("x_accounts")
                  .update({ reconnect_required: true })
                  .eq("id", a.id),
              );
            return;
          }
          // Compare-and-set: cancellation and another worker cannot both win.
          const claimed = checked(
            await db
              .from("x_posts")
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
            const ids: string[] = [];
            for (const media of job.media as Media[]) {
              const blob = checked(
                await db.storage.from("x-media").download(media.path),
              );
              if (!blob || blob.type !== media.type)
                throw new XError("invalid_media");
              ids.push(
                await uploadMedia(fetcher, token.access_token, blob, deadline),
              );
            }
            if (Date.now() + 21000 > deadline)
              throw new XError("media_timeout");
            sent = true;
            const id = await publish(
              fetcher,
              token.access_token,
              job.text,
              ids,
            );
            checked(
              await db
                .from("x_posts")
                .update({
                  status: "published",
                  x_post_id: id,
                  published_at: new Date().toISOString(),
                  error_code: null,
                })
                .eq("id", job.id),
            );
            processed++;
          } catch (error) {
            const code =
              error instanceof XError
                ? error.code
                : sent
                  ? "confirmation_required"
                  : "publish_failed";
            const uncertain =
              code === "confirmation_required" ||
              (sent && code === "storage_failed");
            checked(
              await db
                .from("x_posts")
                .update({
                  status: uncertain ? "uncertain" : "failed",
                  error_code: uncertain ? "confirmation_required" : code,
                })
                .eq("id", job.id),
            );
            if (code === "reconnect_required")
              checked(
                await db
                  .from("x_accounts")
                  .update({ reconnect_required: true })
                  .eq("id", a.id),
              );
          }
        });
      } catch (error) {
        // Isolate each account. Busy accounts remain queued for the next minute.
        if (!(error instanceof XError && error.code === "account_busy"))
          console.error("x_worker_account_failed");
      }
    }
    return { processed };
  }
  return async (request: Request): Promise<Response> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": app?.origin ?? "null",
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    };
    const reply = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers });
    try {
      if (request.method === "OPTIONS")
        return new Response(null, { status: 204, headers });
      if (request.method === "GET") {
        if (!ready) throw new XError("not_configured", 503);
        const input = new URL(request.url);
        const dest = new URL("/x", app!);
        dest.hash = new URLSearchParams(
          input.searchParams.has("error")
            ? { x_error: "oauth_denied" }
            : {
                x_code: input.searchParams.get("code") || "",
                x_state: input.searchParams.get("state") || "",
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
      const origin = request.headers.get("Origin");
      if (origin && origin !== app?.origin)
        throw new XError("origin_denied", 403);
      if (Number(request.headers.get("Content-Length") || 0) > 32768)
        throw new XError("invalid_request", 413);
      const body = await request.text();
      if (body.length > 32768) throw new XError("invalid_request", 413);
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new XError("invalid_request");
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw new XError("invalid_request");
      if (payload.action === "process") {
        if (
          !config.workerSecret ||
          !(await secretsEqual(
            request.headers.get("X-Worker-Secret") || "",
            config.workerSecret,
          ))
        )
          throw new XError("unauthorized", 401);
        if (!ready) throw new XError("not_configured", 503);
        return reply(await processQueue());
      }
      const bearer =
        request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
      const auth = await db.auth.getUser(bearer);
      const user = auth.error ? null : auth.data.user?.id;
      if (!user) throw new XError("unauthorized", 401);
      if (payload.action === "list") {
        if (!ready)
          return reply({ configured: false, accounts: [], posts: [] });
        const accounts = checked(
          await db
            .from("x_accounts")
            .select(publicAccountFields)
            .eq("user_id", user)
            .order("created_at"),
        );
        const posts = checked(
          await db
            .from("x_posts")
            .select(postFields)
            .eq("user_id", user)
            .order("created_at", { ascending: false })
            .range(0, 199),
        );
        return reply({ configured: true, accounts, posts });
      }
      if (!ready) throw new XError("not_configured", 503);
      if (payload.action === "connect") {
        const state = randomSecret();
        const verifier = randomSecret(48);
        checked(
          await db
            .from("x_oauth_states")
            .insert({
              state_hash: await sha256(state),
              user_id: user,
              verifier: await encrypt(
                verifier,
                await encryptionKey(config.encryptionKey!),
                user,
              ),
              expires_at: new Date(Date.now() + 600000).toISOString(),
            }),
        );
        const url = new URL("https://x.com/i/oauth2/authorize");
        url.search = new URLSearchParams({
          response_type: "code",
          client_id: config.clientId!,
          redirect_uri: callback,
          scope: SCOPES,
          state,
          code_challenge: await challenge(verifier),
          code_challenge_method: "S256",
        }).toString();
        return reply({ url: url.toString() });
      }
      if (payload.action === "callback") {
        if (
          typeof payload.state !== "string" ||
          payload.state.length > 256 ||
          typeof payload.code !== "string" ||
          payload.code.length > 4096
        )
          throw new XError("oauth_state_invalid");
        const state = checked(
          await db
            .from("x_oauth_states")
            .delete()
            .eq("state_hash", await sha256(payload.state))
            .eq("user_id", user)
            .gt("expires_at", new Date().toISOString())
            .select()
            .maybeSingle(),
        );
        if (!state) throw new XError("oauth_state_invalid");
        const value = await tokens(
          fetcher,
          config.clientId!,
          config.clientSecret!,
          new URLSearchParams({
            grant_type: "authorization_code",
            code: payload.code,
            redirect_uri: callback,
            code_verifier: await decrypt(
              state.verifier,
              await encryptionKey(config.encryptionKey!),
              user,
            ),
          }),
        );
        const scopes = new Set(value.scope?.split(" "));
        if (SCOPES.split(" ").some((scope) => !scopes.has(scope)))
          throw new XError("permission_required");
        const profile = await xRequest(
          fetcher,
          value.access_token,
          "/users/me",
        );
        if (
          !/^\d+$/.test(profile.data?.id ?? "") ||
          typeof profile.data.username !== "string" ||
          typeof profile.data.name !== "string"
        )
          throw new XError("x_unavailable");
        const existing = checked(
          await db
            .from("x_accounts")
            .select("id")
            .eq("user_id", user)
            .eq("x_user_id", profile.data.id)
            .maybeSingle(),
        );
        const save = async () => {
          checked(
            await db
              .from("x_accounts")
              .upsert(
                {
                  user_id: user,
                  x_user_id: profile.data.id,
                  username: profile.data.username,
                  name: profile.data.name,
                  ...(await credentials(value, user)),
                },
                { onConflict: "user_id,x_user_id" },
              ),
          );
        };
        if (existing) await withLock(existing.id, save);
        else await save();
        return reply({ success: true });
      }
      if (payload.action === "schedule") {
        const input = validatePost(payload, user);
        const a = await account(input.accountId, user);
        if (a.reconnect_required) throw new XError("reconnect_required");
        for (const media of input.media) {
          const filename = media.path.split("/")[1];
          const objects = checked(
            await db.storage
              .from("x-media")
              .list(user, { search: filename, limit: 10 }),
          );
          const object = objects?.find(
            (item: { name: string }) => item.name === filename,
          );
          if (
            !object ||
            object.metadata?.mimetype !== media.type ||
            Number(object.metadata?.size) >
              (media.type === "video/mp4" ? 20 : 5) * 1024 * 1024
          )
            throw new XError("invalid_media");
        }
        // Client UUID makes resubmission safe after an uncertain browser response.
        checked(
          await db
            .from("x_posts")
            .upsert(
              {
                id: input.id,
                user_id: user,
                account_id: a.id,
                text: input.text,
                media: input.media,
                scheduled_at: input.scheduledAt,
              },
              { onConflict: "id", ignoreDuplicates: true },
            ),
        );
        return reply({ success: true });
      }
      if (payload.action === "cancel") {
        if (!uuid(payload.id)) throw new XError("invalid_post");
        const changed = checked(
          await db
            .from("x_posts")
            .update({ status: "cancelled" })
            .eq("id", payload.id)
            .eq("user_id", user)
            .eq("status", "scheduled")
            .select("id")
            .maybeSingle(),
        );
        if (!changed) throw new XError("post_changed", 409);
        return reply({ success: true });
      }
      if (payload.action === "pause" || payload.action === "disconnect") {
        const a = await account(payload.accountId, user);
        return reply(
          await withLock(a.id, async () => {
            if (payload.action === "pause") {
              if (typeof payload.paused !== "boolean")
                throw new XError("invalid_request");
              checked(
                await db
                  .from("x_accounts")
                  .update({ paused: payload.paused })
                  .eq("id", a.id),
              );
            } else {
              // Keep history and pause every pending post. Removing local credentials stops all publishing.
              checked(
                await db
                  .from("x_accounts")
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
      throw new XError("invalid_action");
    } catch (error) {
      if (error instanceof XError)
        return reply(
          { error: error.code },
          error.status >= 500 ? 503 : error.status,
        );
      console.error("x_publisher_request_failed");
      return reply({ error: "request_failed" }, 500);
    }
  };
}
