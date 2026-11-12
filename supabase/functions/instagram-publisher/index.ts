import { hybridStorage } from '../_shared/hybrid-storage.ts';
import { readVideoAnalytics } from "./analytics.ts";
import { dayWindow } from "./day-window.ts";
import { readPublishedReelsToday, type PublishedTodayReport } from "./published-today.ts";
import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { validate, mediaParams, type Draft } from "./model.ts";
import { buildFlow, type FlowInput } from './flow.ts';
import {
  connectionInput,
  checkProfile,
  discoverProfiles,
} from "./connection.ts";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const fileStorage = hybridStorage(db, Deno.env.get("SUPABASE_URL")!);
const origins = new Set([
  "https://www.organizafy.site", "https://xn--avana-1ra.online", "https://www.xn--avana-1ra.online",
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
  provider = "facebook",
) {
  const url = new URL(
    `https://${provider === "instagram" ? "graph.instagram.com" : "graph.facebook.com"}/${version}/${path}`,
  );
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
    await fileStorage
      .from("instagram-publisher")
      .createSignedUrl(value.slice(10), 3600),
  );
  return data.signedUrl;
}
async function advanceCampaigns() {
  const due = checked(await db.rpc("ig_campaign_due"));
  for (const flow of due) {
    try {
      const input = flow.settings as FlowInput;
      const runtime = checked(await db.rpc("ig_flow_runtime", { p_user: flow.user_id, p_id: flow.id })) as {
        available: string[]; excluded: { account_id: string; url: string }[];
      };
      const library = checked(
        await db
          .from("ig_flow_library")
          .select("id,url,kind,caption,folder")
          .eq("user_id", flow.user_id)
          .eq("retired", false),
      );
      const progress = checked(
        await db.rpc("ig_campaign_progress", {
          p_user: flow.user_id,
          p_id: flow.id,
        }),
      );
      const used = checked(
        await db.rpc("ig_flow_used", {
          p_user: flow.user_id,
          p_urls: library.map((m) => m.url),
        }),
      ).filter((row) => row.flow_id !== flow.id);
      const offsets: Record<string, number> = {},
        starts: Record<string, number> = {};
      const now = Date.now();
      for (const row of progress) {
        offsets[row.account_id] = Number(row.total);
        const rest =
          Number(row.total) > 0 &&
          Number(row.total) % (input.batchSize || 500) === 0
            ? (input.restMinutes || 0) * 60000
            : 0;
        const spacing =
          input.schedule === "slots" ? 180_000 : input.gapMinutes * 60000;
        starts[row.account_id] = Math.max(
          now + 60000,
          Date.parse(row.last_at) + spacing + rest,
        );
      }
      const jobs = buildFlow(
        { ...input, startAt: null },
        library,
        flow.user_id,
        now,
        Math.random,
        { used, offsets, starts, disabledAccounts: input.accountIds.filter(id => !runtime.available.includes(id)), excluded: runtime.excluded },
      );
      checked(
        await db.rpc("ig_append_flow_cycle", {
          p_user: flow.user_id,
          p_id: flow.id,
          p_cycle: flow.cycle,
          p_jobs: jobs,
        }),
      );
    } catch (error) {
      // Preserve existing queued work; pause only an unchanged cycle.
      checked(
        await db
          .from("ig_flows")
          .update({ state: "paused", last_error: error instanceof Error && error.message === "no_unused_media" ? "no_available_media" : "campaign_needs_review" })
          .eq("id", flow.id)
          .eq("cycle", flow.cycle)
          .eq("state", "active"),
      );
    }
  }
}
async function worker() {
  await advanceCampaigns();
  // Cleanup failures never change the outcome of a confirmed publication.
  try {
    checked(await db.rpc('ig_retire_flow_media'));
    const retired = checked(await db.from('ig_flow_library').select('id,url').eq('retired',true).limit(100));
    if (retired.length) {
      checked(await fileStorage.from('instagram-publisher').remove(retired.map(m => m.url.slice(10))));
      checked(await db.from('ig_flow_library').delete().in('id',retired.map(m => m.id)));
    }
  } catch { /* Retry cleanup on the next tick. */ }
  const lock = crypto.randomUUID();
  const job = checked(await db.rpc("ig_claim_job", { p_token: lock }))?.[0];
  if (!job) return { processed: 0 };
  let publishing = job.publish_started;
  async function update(values: Record<string, unknown>) {
    if (job.flow_id && values.status === "scheduled") {
      const flow = checked(await db.from("ig_flows").select("state").eq("id",job.flow_id).single());
      if(flow.state === "stopped") values.status="cancelled";
    }
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
    const accountGraph = (
      path: string,
      access: string,
      params: Record<string, string> = {},
      post = false,
    ) => graph(path, access, params, post, c.provider);
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
          const child = await accountGraph(
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
        if (job.format === 'Reel' && job.cover_url) params.cover_url = await signed(job.cover_url);
        if (job.format !== "Story") params.caption = job.caption;
      }
      const created = await accountGraph(
        c.graph_id + "/media",
        token,
        params,
        true,
      );
      if (!created.id) throw new Error("invalid_container");
      container = created.id;
      await update({ container_id: container });
    }
    const state = await accountGraph(container, token, {
      fields: "status_code",
    });
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
    const campaign = job.flow_id ? checked(await db.from("ig_flows").select("state").eq("id",job.flow_id).single()) : null;
    if (campaign && campaign.state !== "active") {
      await update({status:campaign.state === "stopped" ? "cancelled" : "scheduled"});
      return {processed:0};
    }
    if (current.paused || current.reconnect_required) {
      await update({ status: "scheduled" });
      return { processed: 0 };
    }
    // Persist the publication boundary BEFORE calling Meta. Never retry after this point.
    await update({ publish_started: true });
    publishing = true;
    const result = await accountGraph(
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
    if (["meta_190", "meta_10", "meta_200", "credential_missing"].includes(code))
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
    if (Number(req.headers.get("content-length") || 0) > 100000)
      return reply({ error: "request_too_large" }, 413);
    const raw = await req.text();
    if (raw.length > 100000) return reply({ error: "request_too_large" }, 413);
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
        const profile = await graph(
          connection.graph_id,
          token,
          {
            fields: "id,username",
          },
          false,
          connection.provider,
        );
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
    if (body.action === "discover" || body.action === "connect") {
      const token = connectionInput(body.token, body.graph_id);
      if (body.action === "discover") {
        const profiles = body.graph_id
          ? [await checkProfile(graph, token, body.graph_id)]
          : await discoverProfiles(graph, token);
        return reply({ profiles });
      }
      if (!body.graph_id) throw new Error("invalid_instagram_id");
      // Revalidate at save time; never trust profile names or owner IDs from the browser.
      const profile = await checkProfile(graph, token, body.graph_id);
      const existing = checked(
        await db
          .from("ig_publisher_connections")
          .select("provider")
          .eq("graph_id", profile.id)
          .maybeSingle(),
      );
      if (existing?.provider === "instagram")
        throw new Error("use_instagram_login");
      const saved = await db.rpc("ig_connect_account", {
        p_user: user.id,
        p_graph: profile.id,
        p_username: profile.username,
        p_token: token,
      });
      if (saved.error?.message === "account_already_connected")
        return reply({ error: "account_already_connected" }, 409);
      const account_id = checked(saved);
      return reply({ account_id, username: profile.username });
    }
    if (body.action === "published_today") {
      const now = Date.now();
      const timezone = typeof body.timezone === "string" ? body.timezone : "America/Fortaleza";
      const { start, end } = dayWindow(timezone, now);
      const owned = checked(await db.from("ig_publisher_connections").select("account_id").eq("user_id", user.id));
      const accounts: PublishedTodayReport["accounts"] = [];
      for (let offset = 0; offset < owned.length; offset += 4) {
        accounts.push(...await Promise.all(owned.slice(offset, offset + 4).map(async (account) => {
          try {
            const { c, token } = await credential(account.account_id);
            const result = await readPublishedReelsToday(c.graph_id,
              (path, params) => graph(path, token, params, false, c.provider), timezone, now);
            return { account_id: account.account_id, ...result, unavailable: false };
          } catch {
            return { account_id: account.account_id, count: null, complete: false, unavailable: true };
          }
        })));
      }
      return reply({ accounts, start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString(), checked_at: new Date(now).toISOString(), timezone } satisfies PublishedTodayReport);
    }
    if (body.action === "analytics") {
      const owned = checked(await db.from("ig_publisher_connections").select("account_id").eq("user_id", user.id));
      const accounts = [];
      for (const account of owned.filter(a => !body.account_id || a.account_id === body.account_id)) {
        try {
          const { c, token } = await credential(account.account_id);
          const result = await readVideoAnalytics(account.account_id, c.graph_id,
            (path, params) => graph(path, token, params, false, c.provider),
            typeof body.after === "string" && body.after.length <= 2000 ? body.after : undefined);
          accounts.push({ account_id: account.account_id, ...result, unavailable: false });
        } catch {
          accounts.push({ account_id: account.account_id, videos: [], complete: false, unavailable: true });
        }
      }
      return reply({ accounts, checked_at: new Date().toISOString() });
    }
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
      const profile = await graph(
        c.graph_id,
        token,
        { fields: "id,username" },
        false,
        c.provider,
      );
      return reply({ id: profile.id, username: profile.username });
    }
    if (body.action === "reconnect") {
      const owned = checked(
        await db
          .from("ig_publisher_connections")
          .select("account_id,graph_id,provider")
          .eq("account_id", body.account_id)
          .eq("user_id", user.id)
          .maybeSingle(),
      );
      if (!owned || typeof body.token !== "string" || body.token.length > 4096)
        return reply({ error: "invalid_connection" }, 400);
      if (owned.provider === "instagram")
        return reply({ error: "use_instagram_login" }, 400);
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
    if (body.action === 'add_flow_accounts') {
      if (!Array.isArray(body.account_ids) || !body.account_ids.length || body.account_ids.length > 50 || body.account_ids.some((id: unknown) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) throw new Error("invalid_accounts");
      return reply(checked(await db.rpc("ig_add_flow_accounts", { p_user: user.id, p_id: body.id, p_accounts: body.account_ids })));
    }
    if (body.action === 'create_flow') {
      const input = body.flow as FlowInput;
      const library = checked(await db.from('ig_flow_library').select('id,url,kind,caption,folder').eq('user_id',user.id).eq('retired',false));
      const existing = checked(await db.from("ig_flows").select("id").eq("id",input.id).eq("user_id",user.id).maybeSingle());
      if(existing) {
        checked(await db.rpc('ig_create_flow',{p_user:user.id,p_id:input.id,p_name:input.name,p_settings:input,p_jobs:[]}));
        return reply({ok:true});
      }
      const used = input.avoidReuse ? checked(await db.rpc("ig_flow_used",{p_user:user.id,p_urls:library.map(m=>m.url)})) : [];
      const jobs = buildFlow(input,library,user.id,Date.now(),Math.random,{used});
      checked(await db.rpc('ig_create_flow',{p_user:user.id,p_id:input.id,p_name:input.name.trim() || (input.kind === 'stories' ? 'Fluxo de Stories' : 'Novo fluxo'),p_settings:input,p_jobs:jobs}));
      return reply({ok:true});
    }
    if (body.action === 'cancel_flow') {
      checked(await db.rpc('ig_control_flow',{p_user:user.id,p_id:body.id,p_action:'stop'}));
      return reply({ok:true});
    }
    if (body.action === 'delete_flow') {
      await db.rpc('ig_control_flow',{p_user:user.id,p_id:body.id,p_action:'stop'}).catch(()=>null);
      await db.from('ig_publication_jobs').update({flow_id:null}).eq('flow_id',body.id).eq('user_id',user.id);
      checked(await db.from('ig_flows').delete().eq('id',body.id).eq('user_id',user.id));
      return reply({ok:true});
    }
    if (body.action === "control_flow") {
      checked(await db.rpc("ig_control_flow",{p_user:user.id,p_id:body.id,p_action:body.control}));
      return reply({ok:true});
    }
    if (body.action === "campaign_report") return reply(checked(await db.rpc("ig_campaign_report",{p_user:user.id})));
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
