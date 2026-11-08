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
  media = "55555555-5555-4555-8555-555555555555",
  slotAccount = "66666666-6666-4666-8666-666666666666",
  slotFlow = "77777777-7777-4777-8777-777777777777",
  slotMedia = "88888888-8888-4888-8888-888888888888";
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
  await db.exec(read("20261107000000_instagram_slot_claim.sql"));
  await db.exec(read("20261107050821_instagram_slot_queue_pacing.sql"));
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
  // The SQL slot resolver uses real offsets, including non-hour DST changes.
  const nextSlot = async (after, slots, timeZone) =>
    (
      await db.query(
        "select public.ig_next_slot_at_or_after($1::timestamptz,$2::jsonb,$3) as at",
        [after, JSON.stringify(slots), timeZone],
      )
    ).rows[0].at;
  assert.equal(
    Date.parse(
      await nextSlot(
        "2026-04-02T10:38:00.000Z",
        ["10:00", "10:15", "10:30", "10:45"],
        "UTC",
      ),
    ),
    Date.parse("2026-04-02T10:45:00.000Z"),
    "slot selection follows actual rest and the three-minute floor",
  );
  assert.equal(
    Date.parse(
      await nextSlot("2026-11-01T05:15:00.000Z", ["01:30"], "America/New_York"),
    ),
    Date.parse("2026-11-01T05:30:00.000Z"),
    "the first occurrence of an ambiguous wall time is selected",
  );
  assert.equal(
    Date.parse(
      await nextSlot("2026-11-01T05:45:00.000Z", ["01:30"], "America/New_York"),
    ),
    Date.parse("2026-11-01T06:30:00.000Z"),
    "the second occurrence is selected after the cursor passes the first",
  );
  assert.equal(
    Date.parse(
      await nextSlot("2026-03-08T06:15:00.000Z", ["02:30"], "America/New_York"),
    ),
    Date.parse("2026-03-09T06:30:00.000Z"),
    "a nonexistent local time is skipped for that day",
  );
  assert.equal(
    Date.parse(
      await nextSlot("2026-04-04T15:00:00.000Z", ["01:45"], "Australia/Lord_Howe"),
    ),
    Date.parse("2026-04-04T15:15:00.000Z"),
    "a 30-minute DST change is not treated as a one-hour change",
  );

  // Fixed-slot flows ignore a long configured GAP when pacing from real completion.
  await db.query("insert into public.instagram_accounts values ($1,$2)", [
    slotAccount,
    user,
  ]);
  const slotSecret = crypto.randomUUID();
  await db.query(
    "insert into vault.secrets values($1)",
    [slotSecret],
  );
  await db.query(
    "insert into public.ig_publisher_connections(account_id,user_id,graph_id,secret_id) values($1,$2,$3,$4)",
    [slotAccount, user, "456", slotSecret],
  );
  const slotUrl = `storage://${user}/slot-video.mp4`;
  await db.query(
    "insert into public.ig_flow_library(id,user_id,url,kind) values($1,$2,$3,$4)",
    [slotMedia, user, slotUrl, "posts"],
  );
  const utcNow = new Date();
  const slotBase = new Date(
    Date.UTC(
      utcNow.getUTCFullYear(),
      utcNow.getUTCMonth(),
      utcNow.getUTCDate(),
      utcNow.getUTCHours(),
      utcNow.getUTCMinutes(),
    ),
  );
  const slotLabel = (date) => date.toISOString().slice(11, 16);
  const currentSlots = [
    slotLabel(slotBase),
    slotLabel(new Date(slotBase.getTime() + 3 * 60000)),
  ].sort();
  const slotFirst = {
    id: crypto.randomUUID(),
    account_id: slotAccount,
    caption: "slot-first",
    format: "Reel",
    media_urls: [slotUrl],
    scheduled_at: new Date(Date.now() - 60000).toISOString(),
    cover_url: null,
  };
  const slotSecond = {
    ...slotFirst,
    id: crypto.randomUUID(),
    caption: "slot-second",
  };
  await db.query("select public.ig_create_flow($1,$2,$3,$4,$5)", [
    user,
    slotFlow,
    "Fixed slots",
    JSON.stringify({
      accountIds: [slotAccount],
      mediaIds: [slotMedia],
      schedule: "slots",
      slots: currentSlots,
      timeZone: "UTC",
      gapMinutes: 60,
      batchSize: 1,
      restMinutes: 20,
      avoidReuse: false,
    }),
    JSON.stringify([slotFirst, slotSecond]),
  ]);
  await db.query(
    "update public.ig_publication_jobs set status='published',published_at=now()-interval '2 minutes' where id=$1",
    [slotFirst.id],
  );
  assert.equal(
    (
      await db.query("select * from public.ig_claim_job($1)", [
        crypto.randomUUID(),
      ])
    ).rows.length,
    0,
    "fixed-slot claims wait for actual batch rest and the safety floor",
  );
  await db.query(
    "update public.ig_publication_jobs set published_at=now()-interval '24 minutes' where id=$1",
    [slotFirst.id],
  );
  const slotClaim = await db.query("select * from public.ig_claim_job($1)", [
    crypto.randomUUID(),
  ]);
  assert.equal(
    slotClaim.rows.length,
    1,
    "slot queue uses actual completion plus batch rest, not the 60-minute GAP",
  );
  assert.equal(
    slotClaim.rows[0].id,
    slotSecond.id,
    "slot flow claims its next due job",
  );
  assert.equal(
    (
      await db.query("select * from public.ig_claim_job($1)", [
        crypto.randomUUID(),
      ])
    ).rows.length,
    0,
    "an in-progress account publication prevents a second claim",
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
  await assert.rejects(
    db.query(
      "select public.ig_next_slot_at_or_after(now(),'[\"09:00\"]'::jsonb,'UTC')",
    ),
    /permission denied/,
  );
  await db.exec("reset role");
  console.log(
    "PASS: migrations, owner isolation, no duplicate reservations, pause/resume/stop, idempotent recurrence, GAP and fixed-slot queue pacing, actual-time batch rest, DST resolution, lock protection, uncertain-outcome protection, report and retained media.",
  );
} finally {
  await db.close();
}
