// Requires local Docker. Runs only against an isolated disposable PostgreSQL.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const name = `organizafy-queue-test-${randomUUID()}`;
function run(args, input = "") {
  return new Promise((resolve, reject) => {
    const process = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", error = "";
    process.stdout.on("data", (chunk) => output += chunk);
    process.stderr.on("data", (chunk) => error += chunk);
    process.on("error", reject);
    process.on(
      "close",
      (code) => code === 0 ? resolve(output) : reject(new Error(error)),
    );
    process.stdin.end(input);
  });
}
const sql = (query) =>
  run([
    "exec",
    "-i",
    name,
    "psql",
    "-U",
    "postgres",
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
  ], query);
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
try {
  await run([
    "run",
    "-d",
    "--rm",
    "--network",
    "none",
    "--name",
    name,
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "postgres:17-alpine",
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await run(["exec", name, "pg_isready", "-U", "postgres"]);
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  assert(ready, "PostgreSQL did not become ready");
  await sql(
    read("supabase/tests/fixtures/instagram-publisher-queue.sql") +
      read("supabase/migrations/20261113123501_gap_account_delay.sql") +
      read("supabase/migrations/20261113134117_scalable_instagram_flows.sql") +
      `
    insert into ig_flows(id,user_id,settings)
    select md5('flow-'||f)::uuid,md5('owner-'||f)::uuid,jsonb_build_object('gapMinutes',3,'accountIds','[]'::jsonb) from generate_series(1,10) f;
    insert into ig_publisher_connections(account_id,user_id)
    select md5('account-'||a)::uuid,md5('owner-'||((a-1)/20+1))::uuid from generate_series(1,200) a;
    insert into ig_publication_jobs(user_id,account_id,flow_id,format,media_urls,scheduled_at,flow_base_at)
    select c.user_id,c.account_id,f.id,'Reel',array['load-'||n||'.mp4'],now()-interval '2 hours'+n*interval '1 minute',now()-interval '2 hours'+n*interval '1 minute'
    from ig_publisher_connections c join ig_flows f on f.user_id=c.user_id cross join generate_series(1,100) n;`,
  );
  const start = Date.now();
  const claims = [];
  let calls = 0;
  await Promise.all(Array.from({ length: 32 }, async () => {
    for (let batch = 0; batch < 2; batch++) {
      const result = await sql(
        "begin; select id||','||account_id from ig_claim_job(gen_random_uuid()); select pg_sleep(0.15); commit;",
      );
      calls++;
      claims.push(...result.split("\n").filter((line) => line.includes(",")));
    }
  }));
  const accounts = claims.map((claim) => claim.split(",")[1]);
  assert.equal(
    accounts.length,
    new Set(accounts).size,
    "Two clients claimed the same account",
  );
  assert(accounts.length > 1, "Concurrent clients did not claim work");
  assert.equal(
    (await sql(
      "select count(*) from (select account_id from ig_publication_jobs where status='processing' group by account_id having count(*)>1) d;",
    )).trim(),
    "0",
  );
  console.log(
    JSON.stringify({
      queuedJobs: 20000,
      accounts: 200,
      concurrentClients: 32,
      claimCalls: calls,
      claimedAccounts: accounts.length,
      duplicateLeases: 0,
      elapsedSeconds: (Date.now() - start) / 1000,
    }),
  );
} finally {
  await run(["rm", "-f", name]).catch(() => {});
}
