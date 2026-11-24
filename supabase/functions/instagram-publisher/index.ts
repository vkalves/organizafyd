import { workerPartition, type WorkerPartition } from "../_shared/publisher-workers.ts";
import { integrationOrigins, connectionSiteOrigin } from "../_shared/integration-origins.ts";
import {
  librarySharing,
  type LibrarySharingDatabase,
} from "./library-sharing.ts";
import { requireApprovedAccount } from "../_shared/account-approval.ts";
import { hybridStorage } from "../_shared/hybrid-storage.ts";
import {
  type AccountProfile,
  readAccountOverview,
  readVideoAnalytics,
} from "./analytics.ts";
import { dayWindow } from "./day-window.ts";
import { readSharedFlowProgress } from "./shared-flow-progress.ts";
import {
  type PublishedTodayReport,
  readPublishedReelsToday,
} from "./published-today.ts";
import { createBackendClient } from "../_shared/aws-backend.ts";
import { type Draft, mediaParams, validate } from "./model.ts";
import { buildFlowJobs, type FlowInput, type LibraryMedia } from "./flow.ts";
import { drainQueue, readPages, stageJobs } from "./queue.ts";
import { publishContainer } from "./publication.ts";
import { GraphFailure, canRetryBeforePublication, quotaExhausted } from "./publication-policy.ts";
import { campaignMediaUrl } from "../instagram-media/token.ts";
import {
  checkProfile,
  connectionInput,
  discoverProfiles,
} from "./connection.ts";
const apiUrl = (Deno.env.get("AWS_API_URL") || Deno.env.get("SUPABASE_URL"))!;
const serviceKey = (Deno.env.get("AWS_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
const db = createBackendClient();
requireApprovedAccount(db);
const fileStorage = hybridStorage(db, apiUrl);
const origins = integrationOrigins(Deno.env.get("AVANCA_EXTRA_ORIGINS"), connectionSiteOrigin(Deno.env.get("AVANCA_SITE_ORIGIN")));
function checked<T>({ data, error }: { data: T; error: unknown }): T {
  if (
    error && typeof error === "object" && "message" in error && [
      "account_connection_disabled",
      "account_limit_reached",
      "invalid_flow_invite",
      "campaign_not_active",
      "invalid_accounts",
      "account_not_connected",
      "flow_too_large",
    ].includes(String(error.message))
  ) throw new Error(String(error.message));
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
    `https://${
      provider === "instagram" ? "graph.instagram.com" : "graph.facebook.com"
    }/${version}/${path}`,
  );
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (!post) {
    url.search = new URLSearchParams({
      ...params,
      access_token: token,
    }).toString();
  }
  const res = await fetch(url, {
    method: post ? "POST" : "GET",
    headers,
    body: post
      ? new URLSearchParams({ ...params, access_token: token })
      : undefined,
    signal: AbortSignal.timeout(
      post && (path.endsWith("/media_publish") || path.endsWith("/media")) ? 60_000 : 20_000,
    ),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new GraphFailure(res.status, data.error || {}, token, path);
  }
  return data;
}
/**
 * Stores one follower snapshot per account per UTC day and returns the last 90 days.
 * Meta does not expose a historical follower total, so growth is built from snapshots.
 * Failures never block the analytics response.
 */
async function recordFollowerSnapshot(
  userId: string,
  accountId: string,
  profile: AccountProfile,
) {
  try {
    const now = new Date();
    if (profile.followers_count !== null) {
      await db.from("ig_account_metrics_daily").upsert({
        account_id: accountId,
        user_id: userId,
        day: now.toISOString().slice(0, 10),
        followers_count: profile.followers_count,
        follows_count: profile.follows_count,
        media_count: profile.media_count,
        updated_at: now.toISOString(),
      }, { onConflict: "account_id,day" });
    }
    const since = new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10);
    const { data, error } = await db.from("ig_account_metrics_daily")
      .select("day,followers_count")
      .eq("account_id", accountId)
      .eq("user_id", userId)
      .gte("day", since)
      .order("day", { ascending: true })
      .limit(120);
    if (error || !Array.isArray(data)) return [];
    return data.flatMap((row: { day: unknown; followers_count: unknown }) =>
      typeof row.day === "string" && typeof row.followers_count === "number"
        ? [{ day: row.day.slice(0, 10), followers_count: row.followers_count }]
        : []
    );
  } catch {
    return [];
  }
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
  if (
    !data || typeof data !== "object" || !("signedUrl" in data) ||
    typeof data.signedUrl !== "string"
  ) throw new Error("storage_error");
  return data.signedUrl;
}
async function deliverClean(value: string, jobId: string) {
  if (!value.startsWith("storage://")) return value;
  if (Deno.env.get("AWS_S3_BUCKET")) {
    const res = await db.functions.invoke("s3-storage", {
      body: {
        action: "deliver",
        bucket: "instagram-publisher",
        path: value.slice(10),
        job: jobId,
      },
      timeout: 60_000,
    });
    if (!res.error && typeof res.data?.signedUrl === "string") {
      return res.data.signedUrl;
    }
    throw new Error("storage_error");
  }
  return campaignMediaUrl(value, jobId, apiUrl, serviceKey);
}
async function flowLibrary(user: string) {
  return await readPages<LibraryMedia>(async (from, to) =>
    checked(
      await db.from("ig_flow_library")
        .select("id,url,kind,caption,folder").eq("user_id", user).eq(
          "retired",
          false,
        )
        .order("id").range(from, to),
    ) ?? []
  );
}
async function flowUsed(user: string, urls: string[]) {
  // Each request stays below URL/body and PostgREST row limits.
  const rows: { account_id: string; url: string; flow_id: string }[] = [];
  for (let offset = 0; offset < urls.length; offset += 200) {
    rows.push(
      ...await readPages<{ account_id: string; url: string; flow_id: string }>(
        async (from, to) =>
          checked(
            await db.rpc("ig_flow_used", {
              p_user: user,
              p_urls: urls.slice(offset, offset + 200),
            }).order("account_id").order("url").order("flow_id").range(
              from,
              to,
            ),
          ),
      ),
    );
  }
  return rows;
}
async function enqueuePlan(
  user: string,
  jobs: ReturnType<typeof buildFlowJobs>,
  commit: (plan: { plan_id: string; batches: number }) => Promise<unknown>,
) {
  let planId: string | undefined;
  try {
    const plan = await stageJobs(jobs, async (batch) => {
      planId = batch.plan_id;
      checked(
        await db.from("ig_flow_job_batches").insert({
          ...batch,
          user_id: user,
        }),
      );
    });
    return await commit(plan);
  } finally {
    // Expiry maintenance also catches interrupted isolates; cleanup errors do not
    // turn a confirmed transaction into a client-visible failure.
    if (planId) {
      await db.from("ig_flow_job_batches").delete().eq("plan_id", planId).eq(
        "user_id",
        user,
      );
    }
  }
}
async function advanceCampaigns() {
  const due = checked(await db.rpc("ig_campaign_due"));
  for (const flow of due.slice(0, 5)) {
    try {
      const input = flow.settings as FlowInput;
      const runtime = checked(
        await db.rpc("ig_flow_runtime", {
          p_user: flow.user_id,
          p_id: flow.id,
        }),
      ) as {
        available: string[];
        excluded: { account_id: string; url: string }[];
      };
      const library = await flowLibrary(flow.user_id);
      const progress = checked(
        await db.rpc("ig_campaign_progress", {
          p_user: flow.user_id,
          p_id: flow.id,
        }),
      );
      const used = (await flowUsed(flow.user_id, library.map((m) => m.url)))
        .filter((row) => row.flow_id !== flow.id);
      const offsets: Record<string, number> = {},
        starts: Record<string, number> = {};
      const now = Date.now();
      for (const row of progress) {
        offsets[row.account_id] = Number(row.total);
        const rest = Number(row.total) > 0 &&
            Number(row.total) % (input.batchSize || 500) === 0
          ? (input.restMinutes || 0) * 60000
          : 0;
        const spacing = input.schedule === "slots"
          ? 180_000
          : input.gapMinutes * 60000;
        starts[row.account_id] = Math.max(
          now + 60000,
          Date.parse(row.last_at) + spacing + rest,
        );
      }
      const jobs = buildFlowJobs(
        { ...input, startAt: null },
        library,
        flow.user_id,
        now,
        Math.random,
        {
          used,
          offsets,
          starts,
          disabledAccounts: input.accountIds.filter((id) =>
            !runtime.available.includes(id)
          ),
          excluded: runtime.excluded,
        },
      );
      await enqueuePlan(
        flow.user_id,
        jobs,
        async (plan) =>
          checked(
            await db.rpc("ig_append_flow_cycle", {
              p_user: flow.user_id,
              p_id: flow.id,
              p_cycle: flow.cycle,
              p_jobs: plan,
            }),
          ),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "network_error";
      if (
        ![
          "no_unused_media",
          "invalid_flow",
          "invalid_accounts",
          "invalid_media",
          "invalid_media_owner",
          "invalid_gap",
          "invalid_schedule",
          "invalid_campaign",
          "invalid_caption",
          "invalid_timezone",
        ].includes(reason)
      ) {
        console.error("instagram_cycle_preparation_failed");
        continue;
      }
      // Preserve existing queued work; pause only an unchanged cycle.
      checked(
        await db
          .from("ig_flows")
          .update({
            state: "paused",
            last_error:
              error instanceof Error && error.message === "no_unused_media"
                ? "no_available_media"
                : "campaign_needs_review",
          })
          .eq("id", flow.id)
          .eq("cycle", flow.cycle)
          .eq("state", "active"),
      );
    }
  }
}
async function reconcilePublications() {
  const jobs = checked(await db.from("ig_publication_jobs")
    .select("id,account_id,container_id,lock_token")
    .eq("status", "uncertain").eq("publish_started", true)
    .not("container_id", "is", null)
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at").limit(4)) ?? [];
  await Promise.all(jobs.map(async (job) => {
    try {
      const { c, token } = await credential(job.account_id);
      const state = await graph(job.container_id, token, { fields: "status_code" }, false, c.provider);
      const confirmed = state.status_code === "PUBLISHED";
      checked(await db.from("ig_publication_jobs").update({
        ...(confirmed ? { status: "published", published_at: new Date().toISOString(), error_code: null } : {}),
        next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      }).eq("id", job.id).eq("status", "uncertain").eq("lock_token", job.lock_token));
    } catch {
      // A failed confirmation never causes a second publication.
      await db.from("ig_publication_jobs").update({
        next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      }).eq("id", job.id).eq("status", "uncertain").eq("lock_token", job.lock_token);
    }
  }));
}
async function maintenance() {
  // Dispatch may start zero workers when the last job was interrupted.
  checked(await db.rpc("ig_recover_publication_leases"));
  await reconcilePublications();
  await advanceCampaigns();
  // Delete only abandoned preparation, never queued publications.
  checked(
    await db.from("ig_flow_job_batches").delete().lt(
      "created_at",
      new Date(Date.now() - 86400000).toISOString(),
    ),
  );
  // Cleanup failures never change the outcome of a confirmed publication.
  try {
    checked(await db.rpc("ig_retire_flow_media"));
    const retired = checked(
      await db.from("ig_flow_library").select("id,url").eq("retired", true)
        .limit(100),
    );
    if (retired?.length) {
      checked(
        await fileStorage.from("instagram-publisher").remove(
          retired.map((m) => m.url.slice(10)),
        ),
      );
      checked(
        await db.from("ig_flow_library").delete().in(
          "id",
          retired.map((m) => m.id),
        ),
      );
    }
  } catch { /* Retry cleanup on the next tick. */ }
}
async function processJob(partition: WorkerPartition) {
  const lock = crypto.randomUUID();
  const job = checked(await db.rpc("ig_claim_job_partition", { p_token: lock, p_shard: partition.shard, p_shards: partition.shards }))?.[0];
  if (!job) return { processed: 0 };
  let publishing = job.publish_started;
  async function update(values: Record<string, unknown>) {
    if (job.flow_id && values.status === "scheduled") {
      const flow = checked(
        await db.from("ig_flows").select("state").eq("id", job.flow_id)
          .single(),
      );
      if (flow?.state === "stopped") values.status = "cancelled";
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
    if (!rows?.length) throw new Error("lock_lost");
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
    let quotaChecked = false;
    async function quotaAvailable() {
      if (quotaChecked) return true;
      quotaChecked = true;
      let report;
      try {
        report = await accountGraph(c.graph_id + "/content_publishing_limit", token, { fields: "quota_usage,config" });
      } catch (error) {
        // Older connections can publish without exposing this optional read.
        // An actual publishing-permission error is still handled on /media.
        if (error instanceof GraphFailure && [100, 10, 200].includes(error.details.code || 0)) return true;
        throw error;
      }
      if (!quotaExhausted(report)) return true;
      const retryAt = new Date(Date.now() + 15 * 60_000).toISOString();
      checked(await db.from("ig_publisher_connections").update({ publish_retry_at: retryAt }).eq("account_id", job.account_id));
      await update({ status: "scheduled", next_attempt_at: retryAt, error_code: "publishing_quota_wait" });
      return false;
    }
    let container = job.container_id;
    if (!container) {
      if (!await quotaAvailable()) return { processed: 1 };
      // A new capability per publication makes Meta download through a fresh
      // server-side cleaning pass, including existing flows and later cycles.
      // Polling an existing container must never recreate it or publish twice.
      const deliveryUrl = job.flow_id
        ? (value: string) => deliverClean(value, job.id)
        : signed;
      const urls = await Promise.all(job.media_urls.map(deliveryUrl));
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
        if (job.format === "Reel" && job.cover_url) {
          params.cover_url = await deliveryUrl(job.cover_url);
        }
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
    if (state.status_code === "PUBLISHED") {
      await update({
        status: "published",
        published_at: new Date().toISOString(),
        error_code: null,
        last_error_details: null,
      });
      return { processed: 1 };
    }
    if (state.status_code === "IN_PROGRESS") {
      const checks = (job.container_checks || 0) + 1;
      if (checks >= 30) throw new Error("media_processing_timeout");
      await update({
        status: "scheduled",
        container_checks: checks,
        // A batch worker can claim again during this tick; defer polling so one
        // processing video cannot consume the whole batch or exhaust attempts.
        next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
      });
      return { processed: 1 };
    }
    if (state.status_code !== "FINISHED") {
      throw new Error("container_" + String(state.status_code));
    }
    if (!await quotaAvailable()) return { processed: 1 };
    const current = checked(
      await db
        .from("ig_publisher_connections")
        .select("paused,reconnect_required")
        .eq("account_id", job.account_id)
        .single(),
    );
    const campaign = job.flow_id
      ? checked(
        await db.from("ig_flows").select("state").eq("id", job.flow_id)
          .single(),
      )
      : null;
    if (campaign && campaign.state !== "active") {
      await update({
        status: campaign.state === "stopped" ? "cancelled" : "scheduled",
      });
      return { processed: 0 };
    }
    if (!current || current.paused || current.reconnect_required) {
      await update({ status: "scheduled" });
      return { processed: 0 };
    }
    // Persist the publication boundary BEFORE calling Meta. Never retry after this point.
    const canPublish = checked(
      await db.rpc("ig_begin_flow_publication", {
        p_job: job.id,
        p_lock: lock,
      }),
    );
    if (!canPublish) return { processed: 0 };
    publishing = true;
    const result = await publishContainer(
      (path, params, post) => accountGraph(path, token, params, post),
      c.graph_id,
      container,
    );
    await update({
      status: "published",
      media_id: result.mediaId,
      published_at: new Date().toISOString(),
      error_code: null,
      last_error_details: null,
    });
  } catch (err) {
    const code = err instanceof Error && /^[a-zA-Z0-9_]+$/.test(err.message)
      ? err.message
      : "network_error";
    if (
      ["meta_190", "meta_10", "meta_200", "credential_missing"].includes(code)
    ) {
      const degradedState = code === "meta_10" || code === "meta_200"
        ? "permissions"
        : "reconnect";
      await db
        .from("ig_publisher_connections")
        .update({ reconnect_required: true })
        .eq("account_id", job.account_id);
      await db
        .from("ig_account_health")
        .update({
          state: degradedState,
          candidate: degradedState,
          failures: 1,
          checked_at: new Date().toISOString(),
          error_code: code,
        })
        .eq("account_id", job.account_id);
    }
    const transient = canRetryBeforePublication(err, code, publishing);
    const retryAt = new Date(Date.now() + Math.min(900_000, 30_000 * 2 ** Math.min(job.attempts, 5)) + Math.floor(Math.random() * 10_000)).toISOString();
    if (code === "meta_4") {
      checked(await db.rpc("ig_defer_publication_app", { p_account: job.account_id, p_retry_at: retryAt }));
    } else if (["meta_17", "meta_32", "meta_613", "meta_429"].includes(code)) {
      checked(await db.from("ig_publisher_connections").update({ publish_retry_at: retryAt }).eq("account_id", job.account_id));
    }
    const details = err instanceof GraphFailure ? err.details : null;
    console.warn(JSON.stringify({ event: "instagram_publication_error", job_id: job.id, account_id: job.account_id, code, publishing, details }));
    await update({
      status: publishing ? "uncertain" : transient ? "scheduled" : "failed",
      error_code: code,
      last_error_details: details,
      ...(transient
        ? {
          next_attempt_at: retryAt,
        }
        : {}),
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
    if (Number(req.headers.get("content-length") || 0) > 100000) {
      return reply({ error: "request_too_large" }, 413);
    }
    const raw = await req.text();
    if (raw.length > 100000) return reply({ error: "request_too_large" }, 413);
    const body = JSON.parse(raw);
    if (["worker", "maintenance", "health"].includes(body.action)) {
      const key = checked(await db.rpc("ig_worker_key"));
      const supplied = req.headers.get("x-worker-secret");
      if (!key || !supplied || supplied !== key) {
        return reply({ error: "unauthorized" }, 401);
      }
      if (body.action === "health") {
        const c = checked(
          await db
            .from("ig_publisher_connections")
            .select("account_id")
            .eq("graph_id", body.graph_id)
            .single(),
        );
        const { c: connection, token } = await credential(c!.account_id);
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
      if (body.action === "maintenance") {
        const lock = crypto.randomUUID();
        const claimed = checked(await db.rpc("publisher_claim_maintenance", { p_token: lock }));
        if (!claimed) return reply({ skipped: true });
        try { await maintenance(); }
        finally { checked(await db.rpc("publisher_release_maintenance", { p_token: lock })); }
        return reply({ ok: true });
      }
      let partition: WorkerPartition;
      try { partition = workerPartition(body); } catch { return reply({ error: "invalid_worker_partition" }, 400); }
      const result = await drainQueue(() => processJob(partition), { maxJobs: 120, budgetMs: 35_000 });
      console.info(JSON.stringify({ event: "publisher_tick", platform: "instagram", ...partition, ...result }));
      return reply(result);
    }
    const jwt = req.headers.get("authorization")?.replace(/^Bearer /i, "");
    if (!jwt) return reply({ error: "unauthorized" }, 401);
    const {
      data: { user },
      error,
    } = await db.auth.getUser(jwt);
    if (error || !user) return reply({ error: "unauthorized" }, 401);
    if (
      [
        "library_identity",
        "library_set_handle",
        "library_shares",
        "library_grant",
        "library_revoke",
        "library_browse",
        "library_download",
        "library_import",
      ].includes(body.action)
    ) {
      return reply(
        await librarySharing(
          db as unknown as LibrarySharingDatabase,
          user.id,
          body,
          signed,
          fileStorage.from("instagram-publisher"),
        ),
      );
    }
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
      if (existing?.provider === "instagram") {
        throw new Error("use_instagram_login");
      }
      const saved = await db.rpc("ig_connect_account", {
        p_user: user.id,
        p_graph: profile.id,
        p_username: profile.username,
        p_token: token,
      });
      if (saved.error?.message === "account_already_connected") {
        return reply({ error: "account_already_connected" }, 409);
      }
      const account_id = checked(saved);
      return reply({ account_id, username: profile.username });
    }
    if (body.action === "published_today") {
      const now = Date.now();
      const timezone = typeof body.timezone === "string"
        ? body.timezone
        : "America/Fortaleza";
      const { start, end } = dayWindow(timezone, now);
      const owned = checked(
        await db.from("ig_publisher_connections").select("account_id").eq(
          "user_id",
          user.id,
        ),
      ) ?? [];
      const accounts: PublishedTodayReport["accounts"] = [];
      for (let offset = 0; offset < owned.length; offset += 4) {
        accounts.push(
          ...await Promise.all(
            owned.slice(offset, offset + 4).map(async (account) => {
              try {
                const { c, token } = await credential(account.account_id);
                const result = await readPublishedReelsToday(
                  c.graph_id,
                  (path, params) =>
                    graph(path, token, params, false, c.provider),
                  timezone,
                  now,
                );
                return {
                  account_id: account.account_id,
                  ...result,
                  unavailable: false,
                };
              } catch {
                return {
                  account_id: account.account_id,
                  count: null,
                  complete: false,
                  unavailable: true,
                };
              }
            }),
          ),
        );
      }
      return reply(
        {
          accounts,
          start_at: new Date(start).toISOString(),
          end_at: new Date(end).toISOString(),
          checked_at: new Date(now).toISOString(),
          timezone,
        } satisfies PublishedTodayReport,
      );
    }
    if (body.action === "analytics") {
      const owned = checked(
        await db.from("ig_publisher_connections").select("account_id").eq(
          "user_id",
          user.id,
        ),
      ) ?? [];
      if (body.list_only === true) return reply({
        metadata_only: true, checked_at: new Date().toISOString(),
        accounts: owned.map(account => ({account_id:account.account_id,videos:[],complete:false,unavailable:false})),
      });
      const accounts = [];
      for (
        const account of owned.filter((a) =>
          !body.account_id || a.account_id === body.account_id
        )
      ) {
        try {
          const { c, token } = await credential(account.account_id);
          const read = (path: string, params: Record<string, string>) =>
            graph(path, token, params, false, c.provider);
          const after = typeof body.after === "string" && body.after.length <= 2000
            ? body.after
            : undefined;
          // Account counters are only read with the first page; later pages only add videos.
          const [result, overview] = await Promise.all([
            readVideoAnalytics(account.account_id, c.graph_id, read, after),
            after
              ? Promise.resolve(null)
              : readAccountOverview(c.graph_id, read).catch(() => null),
          ]);
          const followersHistory = overview?.profile
            ? await recordFollowerSnapshot(user.id, account.account_id, overview.profile)
            : undefined;
          if (overview?.profile) {
            const patch: Record<string, unknown> = {};
            const normalizedUsername = overview.profile.username?.toLowerCase();
            if (
              normalizedUsername &&
              /^[a-z0-9._]{1,30}$/.test(normalizedUsername)
            ) {
              patch.username = normalizedUsername;
            }
            if (overview.profile.profile_picture_url) {
              patch.avatar_url = overview.profile.profile_picture_url;
            }
            if (Object.keys(patch).length > 0) {
              try {
                await db
                  .from("instagram_accounts")
                  .update(patch)
                  .eq("id", account.account_id)
                  .eq("user_id", user.id);
              } catch {
                // Best-effort profile cache sync must never fail analytics.
              }
            }
          }
          accounts.push({
            account_id: account.account_id,
            ...result,
            insights_error: result.insights_error ??
              (overview?.insights_error === "permission_required" ? "permission_required" : null),
            ...(overview
              ? {
                profile: overview.profile,
                overview: overview.insights,
                followers_history: followersHistory ?? [],
              }
              : {}),
            unavailable: false,
          });
        } catch {
          accounts.push({
            account_id: account.account_id,
            videos: [],
            complete: false,
            unavailable: true,
          });
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
      const now = new Date().toISOString();
      try {
        const profile = await graph(
          c.graph_id,
          token,
          { fields: "id,username" },
          false,
          c.provider,
        );
        if (
          typeof profile.username === "string" &&
          /^[a-zA-Z0-9._]{1,30}$/.test(profile.username)
        ) {
          await db
            .from("instagram_accounts")
            .update({ username: profile.username })
            .eq("id", body.account_id)
            .eq("user_id", user.id);
        }
        await db
          .from("ig_publisher_connections")
          .update({ reconnect_required: false })
          .eq("account_id", body.account_id)
          .eq("user_id", user.id);
        await db
          .from("ig_account_health")
          .upsert(
            {
              account_id: body.account_id,
              user_id: user.id,
              state: "healthy",
              candidate: "healthy",
              failures: 0,
              checked_at: now,
              last_healthy_at: now,
              error_code: null,
            },
            { onConflict: "account_id" },
          );
        return reply({ id: profile.id, username: profile.username });
      } catch (err) {
        const code = err instanceof Error && /^[a-zA-Z0-9_]+$/.test(err.message)
          ? err.message
          : "network_error";
        if (["meta_190", "meta_102", "meta_10", "meta_200"].includes(code)) {
          const degradedState = code === "meta_10" || code === "meta_200"
            ? "permissions"
            : "reconnect";
          await db
            .from("ig_publisher_connections")
            .update({ reconnect_required: true })
            .eq("account_id", body.account_id)
            .eq("user_id", user.id);
          await db
            .from("ig_account_health")
            .upsert(
              {
                account_id: body.account_id,
                user_id: user.id,
                state: degradedState,
                candidate: degradedState,
                failures: 1,
                checked_at: now,
                error_code: code,
              },
              { onConflict: "account_id" },
            );
        }
        throw err;
      }
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
      if (
        !owned || typeof body.token !== "string" || body.token.length > 4096
      ) {
        return reply({ error: "invalid_connection" }, 400);
      }
      if (owned.provider === "instagram") {
        return reply({ error: "use_instagram_login" }, 400);
      }
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
      if (!rows?.length) return reply({ error: "account_missing" }, 404);
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
      if (!rows?.length) return reply({ error: "cannot_cancel" }, 409);
      return reply({ ok: true });
    }
    if (body.action === "shared_flow_progress") {
      return reply(
        await readSharedFlowProgress(
          db as unknown as Parameters<typeof readSharedFlowProgress>[0],
          user.id,
        ),
      );
    }
    if (body.action === "list_shared_flow_accounts") {
      return reply(
        checked(
          await db.rpc("ig_list_shared_flow_accounts", { p_user: user.id }),
        ),
      );
    }
    if (
      body.action === "create_flow_invite" ||
      body.action === "revoke_shared_flow_account"
    ) {
      const validId = (value: unknown) =>
        typeof value === "string" &&
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
      if (!validId(body.id)) throw new Error("invalid_flow");
      if (body.action === "create_flow_invite") {
        const code = checked(
          await db.rpc("ig_create_flow_invite", {
            p_user: user.id,
            p_flow: body.id,
          }),
        );
        return reply({ code });
      }
      if (!validId(body.account_id)) throw new Error("invalid_accounts");
      checked(
        await db.rpc("ig_revoke_shared_flow_account", {
          p_user: user.id,
          p_flow: body.id,
          p_account: body.account_id,
        }),
      );
      return reply({ ok: true });
    }
    if (
      body.action === "preview_flow_invite" ||
      body.action === "accept_flow_invite"
    ) {
      const code = typeof body.code === "string"
        ? body.code.trim().toLowerCase()
        : "";
      if (!/^[0-9a-f]{32}$/.test(code)) throw new Error("invalid_flow_invite");
      if (body.action === "preview_flow_invite") {
        return reply(
          checked(
            await db.rpc("ig_preview_flow_invite", {
              p_user: user.id,
              p_code: code,
            }),
          ),
        );
      }
      if (
        !Array.isArray(body.account_ids) || body.account_ids.length < 1 ||
        body.account_ids.length > 50 ||
        body.account_ids.some((id: unknown) =>
          typeof id !== "string" ||
          !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
        )
      ) {
        throw new Error("invalid_accounts");
      }
      return reply(
        checked(
          await db.rpc("ig_accept_flow_invite", {
            p_user: user.id,
            p_code: code,
            p_accounts: body.account_ids,
          }),
        ),
      );
    }
    if (body.action === "add_flow_accounts") {
      if (
        !Array.isArray(body.account_ids) || !body.account_ids.length ||
        body.account_ids.length > 50 || body.account_ids.some((id: unknown) =>
          typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)
        )
      ) {
        throw new Error("invalid_accounts");
      }
      return reply(
        checked(
          await db.rpc("ig_add_flow_accounts", {
            p_user: user.id,
            p_id: body.id,
            p_accounts: body.account_ids,
          }),
        ),
      );
    }
    if (body.action === "create_flow") {
      const input = body.flow as FlowInput;
      const library = await flowLibrary(user.id);
      const existing = checked(
        await db.from("ig_flows").select("id").eq("id", input.id).eq(
          "user_id",
          user.id,
        ).maybeSingle(),
      );
      if (existing) {
        checked(
          await db.rpc("ig_create_flow", {
            p_user: user.id,
            p_id: input.id,
            p_name: input.name,
            p_settings: input,
            p_jobs: [],
          }),
        );
        return reply({ ok: true });
      }
      const used = input.avoidReuse
        ? await flowUsed(user.id, library.map((m) => m.url))
        : [];
      const jobs = buildFlowJobs(
        input,
        library,
        user.id,
        Date.now(),
        Math.random,
        { used },
      );
      await enqueuePlan(
        user.id,
        jobs,
        async (plan) =>
          checked(
            await db.rpc("ig_create_flow", {
              p_user: user.id,
              p_id: input.id,
              p_name: input.name.trim() ||
                (input.kind === "stories" ? "Fluxo de Stories" : "Novo fluxo"),
              p_settings: input,
              p_jobs: plan,
            }),
          ),
      );
      return reply({ ok: true });
    }
    if (body.action === "cancel_flow") {
      checked(
        await db.rpc("ig_control_flow", {
          p_user: user.id,
          p_id: body.id,
          p_action: "stop",
        }),
      );
      return reply({ ok: true });
    }
    if (body.action === "delete_flow") {
      await Promise.resolve(
        db.rpc("ig_control_flow", {
          p_user: user.id,
          p_id: body.id,
          p_action: "stop",
        }),
      ).catch(() => null);
      await db.from("ig_publication_jobs").update({ flow_id: null }).eq(
        "flow_id",
        body.id,
      ).eq("user_id", user.id);
      checked(
        await db.from("ig_flows").delete().eq("id", body.id).eq(
          "user_id",
          user.id,
        ),
      );
      return reply({ ok: true });
    }
    if (body.action === "control_flow") {
      checked(
        await db.rpc("ig_control_flow", {
          p_user: user.id,
          p_id: body.id,
          p_action: body.control,
        }),
      );
      return reply({ ok: true });
    }
    if (body.action === "campaign_report") {
      return reply(
        checked(await db.rpc("ig_campaign_report", { p_user: user.id })),
      );
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
      if (!account || account.reconnect_required) {
        return reply({ error: "account_not_connected" }, 409);
      }
      const row = {
        id: d.id,
        user_id: user.id,
        account_id: d.account_id,
        caption: d.caption,
        format: d.format,
        media_urls: d.media_urls,
        ...(d.cover_url ? { cover_url: d.cover_url } : {}),
        scheduled_at: d.scheduled_at,
      };
      const result = await db.from("ig_publication_jobs").insert(row);
      if (result.error && result.error.code !== "23505") {
        throw new Error("database_error");
      }
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
        ) {
          return reply({ error: "duplicate_conflict" }, 409);
        }
      }
      return reply({ ok: true });
    }
    return reply({ error: "unknown_action" }, 400);
  } catch (err) {
    const message = err instanceof Error && /^[a-zA-Z0-9_]+$/.test(err.message)
      ? err.message
      : "request_failed";
    return reply({ error: message }, message === "database_error" ? 500 : 400);
  }
});
