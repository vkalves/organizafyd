import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { validate, mediaParams, type Draft } from "./model.ts";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const origins = new Set([
  "https://www.organizafy.site",
  "https://organizafy.site",
]);
function checked<T>({ data, error }: { data: T; error: unknown }): T {
  if (error) throw new Error("database_error");
  return data;
}
const version = "v24.0";
async function graph(
  path: string,
  token: string,
  params: Record<string, string> = {},
  post = false,
) {
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (!post)
    url.search = new URLSearchParams({
      ...params,
      access_token: token,
    }).toString();
  const res = await fetch(url, {
    method: post ? "POST" : "GET",
    headers,
    body: post
      ? new URLSearchParams({ ...params, access_token: token })
      : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json();
  if (!res.ok || data.error)
    throw new Error(`meta_${data.error?.code || res.status}`);
  return data;
}
async function credential(id: string) {
  const c = checked(
    await db
      .from("ig_publisher_connections")
      .select("*")
      .eq("account_id", id)
      .single(),
  );
  const token = checked(await db.rpc("ig_vault_read", { p_id: c.secret_id }));
  if (!token) throw new Error("credential_missing");
  return { c, token };
}
async function signed(value: string) {
  if (!value.startsWith("storage://")) return value;
  const data = checked(
    await db.storage
      .from("instagram-publisher")
      .createSignedUrl(value.slice(10), 3600),
  );
  return data.signedUrl;
}
async function worker() {
  const lock = crypto.randomUUID();
  const job = checked(await db.rpc("ig_claim_job", { p_token: lock }))?.[0];
  if (!job) return { processed: 0 };
  let publishing = job.publish_started;
  async function update(values: Record<string, unknown>) {
    const rows = checked(
      await db
        .from("ig_publication_jobs")
        .update(values)
        .eq("id", job.id)
        .eq("lock_token", lock)
        .eq("status", "processing")
        .select("id"),
    );
    if (!rows.length) throw new Error("lock_lost");
  }
  try {
    const { c, token } = await credential(job.account_id);
    if (c.paused || c.reconnect_required) {
      await update({ status: "scheduled" });
      return { processed: 0 };
    }
    let container = job.container_id;
    if (!container) {
      const urls = await Promise.all(job.media_urls.map(signed));
      let params: Record<string, string>;
      if (job.format === "Carrossel") {
        const children = [];
        for (const url of urls) {
          const child = await graph(
            c.graph_id + "/media",
            token,
            { image_url: url, is_carousel_item: "true" },
            true,
          );
          if (!child.id) throw new Error("invalid_container");
          children.push(child.id);
        }
        params = {
          media_type: "CAROUSEL",
          children: children.join(","),
          caption: job.caption,
        };
      } else {
        params = mediaParams(job.format, urls[0], job.media_urls[0]);
        if (job.format !== "Story") params.caption = job.caption;
      }
      const created = await graph(c.graph_id + "/media", token, params, true);
      if (!created.id) throw new Error("invalid_container");
      container = created.id;
      await update({ container_id: container });
    }
    const state = await graph(container, token, { fields: "status_code" });
    if (state.status_code === "IN_PROGRESS") {
      if (job.attempts >= 30) throw new Error("media_processing_timeout");
      await update({
        status: "scheduled",
        // The cron already limits checks to once a minute. Adding 60 seconds
        // here skips the next tick when processing finishes after the boundary.
        next_attempt_at: new Date().toISOString(),
      });
      return { processed: 1 };
    }
    if (state.status_code !== "FINISHED")
      throw new Error("container_" + String(state.status_code));
    const current = checked(
      await db
        .from("ig_publisher_connections")
        .select("paused,reconnect_required")
        .eq("account_id", job.account_id)
        .single(),
    );
    if (current.paused || current.reconnect_required) {
      await update({ status: "scheduled" });
      return { processed: 0 };
    }
    // Persist the publication boundary BEFORE calling Meta. Never retry after this point.
    await update({ publish_started: true });
    publishing = true;
    const result = await graph(
      c.graph_id + "/media_publish",
      token,
      { creation_id: container },
      true,
    );
    if (!result.id) throw new Error("missing_publication_id");
    await update({
      status: "published",
      media_id: result.id,
      published_at: new Date().toISOString(),
      error_code: null,
    });
  } catch (err) {
    const code =
      err instanceof Error && /^[a-zA-Z0-9_]+$/.test(err.message)
        ? err.message
        : "network_error";
    if (code === "meta_190")
      await db
        .from("ig_publisher_connections")
        .update({ reconnect_required: true })
        .eq("account_id", job.account_id);
    await update({
      status: publishing ? "uncertain" : "failed",
      error_code: code,
    });
  }
  return { processed: 1 };
}
Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origins.has(origin)
      ? origin
      : "https://www.organizafy.site",
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    Vary: "Origin",
  };
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  try {
    if (Number(req.headers.get("content-length") || 0) > 20000)
      return reply({ error: "request_too_large" }, 413);
    const raw = await req.text();
    if (raw.length > 20000) return reply({ error: "request_too_large" }, 413);
    const body = JSON.parse(raw);
    if (body.action === "worker" || body.action === "health") {
      const key = checked(await db.rpc("ig_worker_key"));
      const supplied = req.headers.get("x-worker-secret");
      if (!key || !supplied || supplied !== key)
        return reply({ error: "unauthorized" }, 401);
      if (body.action === "health") {
        const c = checked(
          await db
            .from("ig_publisher_connections")
            .select("account_id")
            .eq("graph_id", body.graph_id)
            .single(),
        );
        const { c: connection, token } = await credential(c.account_id);
        const profile = await graph(connection.graph_id, token, {
          fields: "id,username",
        });
        return reply({
          ok: profile.id === connection.graph_id,
          username: profile.username,
        });
      }
      return reply(await worker());
    }
    const jwt = req.headers.get("authorization")?.replace(/^Bearer /i, "");
    if (!jwt) return reply({ error: "unauthorized" }, 401);
    const {
      data: { user },
      error,
    } = await db.auth.getUser(jwt);
    if (error || !user) return reply({ error: "unauthorized" }, 401);
    if (body.action === "status") {
      const accounts = checked(
        await db
          .from("ig_publisher_connections")
          .select("account_id,paused,reconnect_required")
          .eq("user_id", user.id),
      );
      return reply({ accounts });
    }
    if (body.action === "verify") {
      const owned = checked(
        await db
          .from("ig_publisher_connections")
          .select("account_id")
          .eq("account_id", body.account_id)
          .eq("user_id", user.id)
          .maybeSingle(),
      );
      if (!owned) return reply({ error: "account_missing" }, 404);
      const { c, token } = await credential(body.account_id);
      const profile = await graph(c.graph_id, token, { fields: "id,username" });
      return reply({ id: profile.id, username: profile.username });
    }
    if (body.action === "reconnect") {
      const owned = checked(
        await db
          .from("ig_publisher_connections")
          .select("account_id,graph_id")
          .eq("account_id", body.account_id)
          .eq("user_id", user.id)
          .maybeSingle(),
      );
      if (!owned || typeof body.token !== "string" || body.token.length > 4096)
        return reply({ error: "invalid_connection" }, 400);
      const profile = await graph(owned.graph_id, body.token, {
        fields: "id,username",
      });
      if (profile.id !== owned.graph_id) throw new Error("account_mismatch");
      checked(
        await db.rpc("ig_replace_token", {
          p_account: owned.account_id,
          p_token: body.token,
        }),
      );
      return reply({ ok: true });
    }
    if (body.action === "pause") {
      if (typeof body.paused !== "boolean") throw new Error("invalid_pause");
      const rows = checked(
        await db
          .from("ig_publisher_connections")
          .update({ paused: body.paused })
          .eq("account_id", body.account_id)
          .eq("user_id", user.id)
          .select("account_id"),
      );
      if (!rows.length) return reply({ error: "account_missing" }, 404);
      return reply({ ok: true });
    }
    if (body.action === "cancel") {
      const rows = checked(
        await db
          .from("ig_publication_jobs")
          .update({ status: "cancelled" })
          .eq("id", body.id)
          .eq("user_id", user.id)
          .eq("status", "scheduled")
          .select("id"),
      );
      if (!rows.length) return reply({ error: "cannot_cancel" }, 409);
      return reply({ ok: true });
    }
    if (body.action === "schedule") {
      const d = body.post as Draft;
      validate(d, user.id);
      const account = checked(
        await db
          .from("ig_publisher_connections")
          .select("account_id,paused,reconnect_required")
          .eq("account_id", d.account_id)
          .eq("user_id", user.id)
          .maybeSingle(),
      );
      if (!account || account.reconnect_required)
        return reply({ error: "account_not_connected" }, 409);
      const row = {
        id: d.id,
        user_id: user.id,
        account_id: d.account_id,
        caption: d.caption,
        format: d.format,
        media_urls: d.media_urls,
        scheduled_at: d.scheduled_at,
      };
      const result = await db.from("ig_publication_jobs").insert(row);
      if (result.error && result.error.code !== "23505")
        throw new Error("database_error");
      if (result.error) {
        const old = checked(
          await db
            .from("ig_publication_jobs")
            .select(
              "id,user_id,account_id,caption,format,media_urls,scheduled_at",
            )
            .eq("id", d.id)
            .eq("user_id", user.id)
            .maybeSingle(),
        );
        if (
          !old ||
          old.account_id !== row.account_id ||
          old.caption !== row.caption ||
          old.format !== row.format ||
          JSON.stringify(old.media_urls) !== JSON.stringify(row.media_urls) ||
          Date.parse(old.scheduled_at) !== Date.parse(row.scheduled_at!)
        )
          return reply({ error: "duplicate_conflict" }, 409);
      }
      return reply({ ok: true });
    }
    return reply({ error: "unknown_action" }, 400);
  } catch (err) {
    const message =
      err instanceof Error && /^[a-zA-Z0-9_]+$/.test(err.message)
        ? err.message
        : "request_failed";
    return reply({ error: message }, message === "database_error" ? 500 : 400);
  }
});
