// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
const user = "00000000-0000-4000-8000-000000000001",
  a = "00000000-0000-4000-8000-000000000002",
  b = "00000000-0000-4000-8000-000000000003",
  flow = "00000000-0000-4000-8000-000000000004",
  m1 = "00000000-0000-4000-8000-000000000005",
  m2 = "00000000-0000-4000-8000-000000000006",
  guest = "00000000-0000-4000-8000-000000000009";
let db: PGlite;
const rows = async <T = Record<string, unknown>>(
  sql: string,
  args: unknown[] = [],
) => (await db.query<T>(sql, args)).rows;
const sync = async (owner = user) =>
  (await rows(
    "select public.ig_sync_flow_accounts($1,$2,$3::uuid[],$4) as result",
    [user, flow, [b], owner],
  ))[0].result;
const addJob = (media: string, minutes: number, status = "scheduled") =>
  rows(
    "insert into ig_publication_jobs(user_id,account_id,flow_id,format,caption,media_urls,scheduled_at,status) values($1,$2,$3,'Reel','Caption',array[$4],now()+make_interval(mins=>$5),$6)",
    [user, a, flow, media, minutes, status],
  );
const draft = (
  account: string,
  media = "one.mp4",
  at = "2027-01-01T12:00:00Z",
) => ({
  id: crypto.randomUUID(),
  account_id: account,
  media_urls: [media],
  format: "Reel",
  caption: "Caption",
  scheduled_at: at,
});
const append = (jobs: unknown[], cycle = 1) =>
  rows("select public.ig_append_flow_cycle($1,$2,$3,$4::jsonb) as appended", [
    user,
    flow,
    cycle,
    JSON.stringify(jobs),
  ]);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    readFileSync(
      new URL(
        "../../../supabase/tests/fixtures/instagram-publisher-queue.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../../../supabase/migrations/20261113121349_skip_next_flow_post_on_account_entry.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../../../supabase/migrations/20261113123501_gap_account_delay.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../../../supabase/migrations/20261113134117_scalable_instagram_flows.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}, 30000);
beforeEach(async () => {
  await db.exec(
    "truncate ig_flows,ig_publisher_connections,ig_flow_library,ig_publication_jobs,ig_flow_job_batches",
  );
  await rows("insert into ig_flows(id,user_id,settings) values($1,$2,$3)", [
    flow,
    user,
    JSON.stringify({
      accountIds: [a],
      mediaIds: [m1, m2],
      distribution: "all",
      repeat: "loop",
      gapMinutes: 120,
    }),
  ]);
  await rows(
    "insert into ig_publisher_connections(account_id,user_id) values($1,$3),($2,$3)",
    [a, b, user],
  );
  await rows(
    "insert into ig_flow_library(id,user_id,url) values($1,$3,'one.mp4'),($2,$3,'two.mp4')",
    [m1, m2, user],
  );
});
afterAll(async () => {
  await db?.close();
});
describe("large atomic flow preparation and account leases", () => {
  it("creates 1200 jobs from six bounded batches and retries without duplication", async () => {
    await db.exec("delete from ig_flows");
    const plan = crypto.randomUUID();
    for (let i = 0; i < 6; i++) {
      await rows(
        "insert into ig_flow_job_batches(plan_id,user_id,batch_index,jobs) values($1,$2,$3,$4)",
        [
          plan,
          user,
          i,
          JSON.stringify(Array.from({ length: 200 }, () => draft(a))),
        ],
      );
    }
    const settings = JSON.stringify({
      accountIds: [a],
      mediaIds: [m1],
      gapMinutes: 3,
    });
    const args = [
      user,
      flow,
      "Large",
      settings,
      JSON.stringify({ plan_id: plan, batches: 6 }),
    ];
    await rows("select ig_create_flow($1,$2,$3,$4,$5)", args);
    await rows("select ig_create_flow($1,$2,$3,$4,$5)", args);
    expect(
      Number(
        (await rows<{ count: string }>(
          "select count(*) from ig_publication_jobs",
        ))[0].count,
      ),
    ).toBe(1200);
  });
  it("rejects incomplete and foreign-owner plans without leaving a partial flow", async () => {
    await db.exec("delete from ig_flows");
    const plan = crypto.randomUUID();
    await rows("insert into ig_flow_job_batches values($1,$2,0,$3,now())", [
      plan,
      guest,
      JSON.stringify([draft(a)]),
    ]);
    await expect(
      rows("select ig_create_flow($1,$2,$3,$4,$5)", [
        user,
        flow,
        "Bad",
        "{}",
        JSON.stringify({ plan_id: plan, batches: 2 }),
      ]),
    ).rejects.toThrow("incomplete_flow_plan");
    expect(await rows("select * from ig_flows")).toHaveLength(0);
    expect(await rows("select * from ig_publication_jobs")).toHaveLength(0);
  });
  it("rolls back all batches when a late job has invalid ownership", async () => {
    await db.exec("delete from ig_flows");
    const jobs = Array.from({ length: 650 }, () => draft(a));
    jobs[649].media_urls = ["foreign.mp4"];
    await expect(
      rows("select ig_create_flow($1,$2,$3,$4,$5)", [
        user,
        flow,
        "Invalid",
        "{}",
        JSON.stringify(jobs),
      ]),
    ).rejects.toThrow("invalid_media_owner");
    expect(await rows("select * from ig_flows")).toHaveLength(0);
    expect(await rows("select * from ig_publication_jobs")).toHaveLength(0);
  });
  it("appends a cycle above 500 atomically and does not append it twice", async () => {
    const jobs = Array.from({ length: 700 }, () => draft(a));
    expect((await append(jobs))[0].appended).toBe(true);
    expect((await append(jobs))[0].appended).toBe(false);
    expect(
      Number(
        (await rows<{ count: string }>(
          "select count(*) from ig_publication_jobs",
        ))[0].count,
      ),
    ).toBe(700);
  });
  it("enforces an account lease in the database and allows another account", async () => {
    await addJob("one.mp4", -1);
    await addJob("two.mp4", -1);
    await rows(
      "insert into ig_publication_jobs(user_id,account_id,flow_id,media_urls,scheduled_at) values($1,$2,$3,array['one.mp4'],now()-interval '1 minute')",
      [user, b, flow],
    );
    const first = (await rows<{ id: string; account_id: string }>(
      "select * from ig_claim_job(gen_random_uuid())",
    ))[0];
    const second = (await rows<{ account_id: string }>(
      "select * from ig_claim_job(gen_random_uuid())",
    ))[0];
    expect(first.account_id).not.toBe(second.account_id);
    await expect(
      rows(
        "update ig_publication_jobs set status='processing' where status='scheduled'",
      ),
    ).rejects.toThrow("ig_jobs_one_processing_account");
  });
  it("recovers an interrupted preparation but never retries an ambiguous publication", async () => {
    await addJob("one.mp4", -1);
    await addJob("two.mp4", -1);
    await rows(
      "update ig_publication_jobs set status='processing',locked_at=now()-interval '11 minutes' where media_urls=array['one.mp4']",
    );
    await rows("select * from ig_claim_job(gen_random_uuid())");
    expect(
      (await rows(
        "select status from ig_publication_jobs where media_urls=array['one.mp4']",
      ))[0].status,
    ).not.toBe("uncertain");
    await rows(
      "update ig_publication_jobs set publish_started=true,locked_at=now()-interval '11 minutes' where status='processing'",
    );
    await rows("select * from ig_claim_job(gen_random_uuid())");
    expect(
      await rows("select * from ig_publication_jobs where status='uncertain'"),
    ).toHaveLength(1);
  });
  it("allows crossing the publication boundary only once and rejects stale tokens", async () => {
    await addJob("one.mp4", -1);
    const token = crypto.randomUUID();
    const job =
      (await rows<{ id: string }>("select * from ig_claim_job($1)", [token]))[
        0
      ];
    expect(
      (await rows("select ig_begin_flow_publication($1,$2) ok", [
        job.id,
        crypto.randomUUID(),
      ]))[0].ok,
    ).toBe(false);
    expect(
      (await rows("select ig_begin_flow_publication($1,$2) ok", [
        job.id,
        token,
      ]))[0].ok,
    ).toBe(true);
    expect(
      (await rows("select ig_begin_flow_publication($1,$2) ok", [
        job.id,
        token,
      ]))[0].ok,
    ).toBe(false);
  });
  it("denies public access to staging and helper RPCs", async () => {
    const permissions =
      (await rows<{ table_ok: boolean; function_ok: boolean }>(
        "select has_table_privilege('authenticated','ig_flow_job_batches','insert') table_ok,has_function_privilege('anon','ig_flow_job_inputs(uuid,jsonb)','execute') function_ok",
      ))[0];
    expect(permissions).toEqual({ table_ok: false, function_ok: false });
  });
});
