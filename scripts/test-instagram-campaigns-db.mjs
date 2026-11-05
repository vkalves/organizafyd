// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-instagram-campaigns-db.mjs
// Isolated PostgreSQL-compatible database; no production connections or real posts.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(
  process.env.PGLITE_MODULE || "@electric-sql/pglite"
);
const db = new PGlite();
const user = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  account = "33333333-3333-4333-8333-333333333333",
  flow = "44444444-4444-4444-8444-444444444444",
  media = "55555555-5555-4555-8555-555555555555";
const url = `storage://${user}/video.mp4`;
const read = (name) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );
const settings = {
  accountIds: [account],
  mediaIds: [media],
  repeat: "loop",
  avoidReuse: true,
  gapMinutes: 3,
  batchSize: 1,
  restMinutes: 20,
};
const job = () => ({
  id: crypto.randomUUID(),
  account_id: account,
  caption: "test",
  format: "Reel",
  media_urls: [url],
  scheduled_at: new Date(Date.now() - 60000).toISOString(),
  cover_url: null,
});
try {
  await db.exec(
    `create schema auth; create schema vault; create role anon; create role authenticated; create role service_role bypassrls; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create table vault.secrets(id uuid primary key); create table public.instagram_accounts(id uuid,user_id uuid,primary key(id,user_id)); create table public.instagram_publication_drafts(id uuid,user_id uuid,status text,media_urls text[]);`,
  );
  await db.exec(
    read("20261103051144_instagram_publisher_live.sql").split(
      "-- All privileged functions",
    )[0],
  );
  await db.exec(read("20261104114149_instagram_flows.sql"));
  await db.exec(read("20261106000000_instagram_campaigns.sql"));
  await db.query("insert into auth.users values ($1),($2)", [user, other]);
  await db.query("insert into public.instagram_accounts values ($1,$2)", [
    account,
    user,
  ]);
  const secret = crypto.randomUUID();
  await db.query("insert into vault.secrets values($1)", [secret]);
  await db.query(
    "insert into public.ig_publisher_connections(account_id,user_id,graph_id,secret_id) values($1,$2,$3,$4)",
    [account, user, "123", secret],
  );
  await db.query(
    "insert into public.ig_flow_library(id,user_id,url,kind) values($1,$2,$3,$4)",
    [media, user, url, "posts"],
  );
  const first = job();
  await db.query("select public.ig_create_flow($1,$2,$3,$4,$5)", [
    user,
    flow,
    "Campaign",
    JSON.stringify(settings),
    JSON.stringify([first]),
  ]);
  await db.query("select public.ig_create_flow($1,$2,$3,$4,$5)", [
    user,
    flow,
    "Campaign",
    JSON.stringify(settings),
    "[]",
  ]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from public.ig_publication_jobs",
      )
    ).rows[0].n,
    1,
    "creation retry is idempotent",
  );
  assert.equal(
    (await db.query("select * from public.ig_campaign_due()")).rows.length,
    0,
    "pending cycle must not repeat",
  );
  await assert.rejects(
    db.query("select public.ig_create_flow($1,$2,$3,$4,$5)", [
      user,
      crypto.randomUUID(),
      "Duplicate",
      JSON.stringify(settings),
      JSON.stringify([job()]),
    ]),
    /media_already_used/,
  );
  await db.query("select public.ig_control_flow($1,$2,$3)", [
    user,
    flow,
    "pause",
  ]);
  assert.equal(
    (
      await db.query("select * from public.ig_claim_job($1)", [
        crypto.randomUUID(),
      ])
    ).rows.length,
    0,
    "pause blocks claim",
  );
  await assert.rejects(
    db.query("select public.ig_control_flow($1,$2,$3)", [
      other,
      flow,
      "resume",
    ]),
    /invalid_flow/,
  );
  await db.query("select public.ig_control_flow($1,$2,$3)", [
    user,
    flow,
    "resume",
  ]);
  assert.equal(
    (
      await db.query("select * from public.ig_claim_job($1)", [
        crypto.randomUUID(),
      ])
    ).rows.length,
    1,
    "resume restores claim",
  );
  await db.query(
    "update public.ig_publication_jobs set status='published',published_at=now() where id=$1",
    [first.id],
  );
  assert.equal(
    (await db.query("select * from public.ig_campaign_due()")).rows.length,
    1,
    "published cycle is repeatable",
  );
  const next = job();
  assert.equal(
    (
      await db.query("select public.ig_append_flow_cycle($1,$2,$3,$4) as ok", [
        user,
        flow,
        1,
        JSON.stringify([next]),
      ])
    ).rows[0].ok,
    true,
  );
  assert.equal(
    (
      await db.query("select public.ig_append_flow_cycle($1,$2,$3,$4) as ok", [
        user,
        flow,
        1,
        JSON.stringify([job()]),
      ])
    ).rows[0].ok,
    false,
    "racing or repeated cycle append is idempotent",
  );
  assert.equal(
    (
      await db.query("select * from public.ig_claim_job($1)", [
        crypto.randomUUID(),
      ])
    ).rows.length,
    0,
    "rest is enforced using actual publication time even if next job is overdue",
  );
  await db.query(
    "update public.ig_publication_jobs set published_at=now()-interval '24 minutes' where id=$1",
    [first.id],
  );
  assert.equal(
    (
      await db.query("select * from public.ig_claim_job($1)", [
        crypto.randomUUID(),
      ])
    ).rows.length,
    1,
    "claim after GAP plus batch rest",
  );
  await db.query(
    "update public.ig_publication_jobs set status='uncertain' where id=$1",
    [next.id],
  );
  assert.equal(
    (await db.query("select * from public.ig_campaign_due()")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select state from public.ig_flows where id=$1", [flow]))
      .rows[0].state,
    "paused",
    "uncertain outcome pauses recurring campaign",
  );
  await assert.rejects(
    db.query("select public.ig_control_flow($1,$2,$3)", [user, flow, "resume"]),
    /publication_needs_review/,
  );
  await db.query("select public.ig_retire_flow_media()");
  assert.equal(
    (await db.query("select retired from public.ig_flow_library")).rows[0]
      .retired,
    false,
    "media survives publication",
  );
  const report = (
    await db.query("select public.ig_campaign_report($1) as data", [user])
  ).rows[0].data;
  assert.equal(report.flows[0].published, 1);
  assert.equal(report.flows[0].review, 1);
  assert.equal(report.usage[0].published, 1);
  await db.query("select public.ig_control_flow($1,$2,$3)", [
    user,
    flow,
    "stop",
  ]);
  await assert.rejects(
    db.query("select public.ig_control_flow($1,$2,$3)", [user, flow, "resume"]),
    /campaign_stopped/,
  );
  await assert.rejects(
    db.query("select public.ig_control_flow($1,$2,$3)", [user, flow, "pause"]),
    /campaign_stopped/,
  );
  const stoppedFlow = crypto.randomUUID(),
    stoppedJob = job();
  await db.query("select public.ig_create_flow($1,$2,$3,$4,$5)", [
    user,
    stoppedFlow,
    "Stop test",
    JSON.stringify({ ...settings, avoidReuse: false }),
    JSON.stringify([stoppedJob]),
  ]);
  await db.query("select public.ig_control_flow($1,$2,$3)", [
    user,
    stoppedFlow,
    "stop",
  ]);
  assert.equal(
    (
      await db.query(
        "select status from public.ig_publication_jobs where id=$1",
        [stoppedJob.id],
      )
    ).rows[0].status,
    "cancelled",
    "stop cancels queued work",
  );
  assert.equal(
    (await db.query("select * from public.ig_campaign_due()")).rows.length,
    0,
    "stopped campaigns cannot generate cycles",
  );
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${other}',false);`,
  );
  assert.equal(
    (await db.query("select * from public.ig_flows")).rows.length,
    0,
    "RLS isolates campaigns",
  );
  await assert.rejects(
    db.query("select public.ig_campaign_due()"),
    /permission denied/,
  );
  await assert.rejects(db.query("select * from public.ig_claim_job($1)",[crypto.randomUUID()]),/permission denied/);
  await db.exec("reset role");
  console.log(
    "PASS: migration, owner isolation, no duplicate reservations, pause/resume/stop, idempotent recurrence, actual-time batch rest, uncertain-outcome protection, report and retained media.",
  );
} finally {
  await db.close();
}
