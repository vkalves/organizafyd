// Install test tooling outside the checkout, then set PGLITE_MODULE to its path.
// Executes the real migration in an isolated temporary PostgreSQL-compatible DB.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const a = "11111111-1111-1111-1111-111111111111";
const b = "22222222-2222-2222-2222-222222222222";
const task = "33333333-3333-3333-3333-333333333333";
const another = "44444444-4444-4444-4444-444444444444";
const tokenA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tokenB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const migration = readFileSync(new URL("../supabase/migrations/20261015000000_google_calendar.sql", import.meta.url), "utf8");
try {
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE TABLE public.tasks (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL,
      description text, due_date date, status text DEFAULT 'todo',
      completed_at timestamptz, is_fixed_daily boolean DEFAULT false
    );
    ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_tasks ON public.tasks FOR ALL TO authenticated
      USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT ALL ON public.tasks TO authenticated, service_role;
    INSERT INTO auth.users VALUES ('${a}'), ('${b}');
  `);
  await db.exec(migration);
  // Validate scheduler wiring with isolated stand-ins for hosted extensions.
  // This does not claim pg_cron/pg_net/Vault have been deployed to Supabase.
  await db.exec(`
    CREATE SCHEMA vault;
    CREATE SCHEMA cron;
    CREATE TABLE vault.secrets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, value text);
    CREATE FUNCTION vault.create_secret(value text, secret_name text) RETURNS uuid LANGUAGE plpgsql AS $$
      DECLARE result uuid; BEGIN INSERT INTO vault.secrets(name,value) VALUES(secret_name,value) RETURNING id INTO result; RETURN result; END;
    $$;
    CREATE FUNCTION vault.update_secret(secret_id uuid, new_value text) RETURNS void LANGUAGE sql AS $$
      UPDATE vault.secrets SET value=new_value WHERE id=secret_id;
    $$;
    CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY, jobname text, schedule text, command text);
    CREATE FUNCTION cron.schedule(job_name text, pattern text, job_command text) RETURNS bigint LANGUAGE plpgsql AS $$
      DECLARE result bigint; BEGIN INSERT INTO cron.job(jobname,schedule,command) VALUES(job_name,pattern,job_command) RETURNING jobid INTO result; RETURN result; END;
    $$;
    CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE plpgsql AS $$
      BEGIN DELETE FROM cron.job WHERE jobid=job_id; RETURN FOUND; END;
    $$;
  `);
  const workerSecret = "test-worker-secret-for-isolated-scheduler";
  await db.query("SELECT configure_google_calendar_worker($1,$2)", ["https://project.supabase.co", workerSecret]);
  await db.query("SELECT configure_google_calendar_worker($1,$2)", ["https://project.supabase.co", workerSecret]);
  const jobs = (await db.query("SELECT * FROM cron.job")).rows;
  assert.equal(jobs.length, 1, "worker installation is repeatable");
  assert.equal(jobs[0].schedule, "* * * * *");
  assert.ok(jobs[0].command.includes("vault.decrypted_secrets"));
  assert.ok(jobs[0].command.includes("120000"));
  assert.ok(!jobs[0].command.includes(workerSecret), "worker secret is not exposed in cron command text");
  assert.equal((await db.query("SELECT * FROM vault.secrets")).rows.length, 2);
  await assert.rejects(db.query("SELECT configure_google_calendar_worker($1,$2)", ["https://foreign.example", workerSecret]), /Supabase project URL/);
  await assert.rejects(db.query("SELECT configure_google_calendar_worker($1,$2)", ["https://project.supabase.co", "short"]), /at least 32 characters/);
  await assert.rejects(db.query("SELECT configure_google_calendar_worker($1,$2)", [null, workerSecret]), /Supabase project URL/);
  console.log("PASS: scheduler validation, repeatability and Vault references (hosted extensions mocked)");
  await db.query("INSERT INTO tasks(id,user_id,title,due_date) VALUES ($1,$2,'Initial','2026-10-15')", [task, a]);
  assert.equal((await db.query("SELECT * FROM google_calendar_sync_queue")).rows.length, 0);
  await db.query("INSERT INTO google_calendar_connections(user_id,google_account_id,refresh_token_encrypted) VALUES ($1,'account-a','test-ciphertext')", [a]);
  assert.equal((await db.query("SELECT google_calendar_enqueue_all($1) AS count", [a])).rows[0].count, 1);
  const first = (await db.query("SELECT * FROM google_calendar_sync_queue")).rows[0];
  await db.query("UPDATE tasks SET title = 'Updated', due_date = '2026-10-16' WHERE id = $1", [task]);
  const updated = (await db.query("SELECT * FROM google_calendar_sync_queue")).rows[0];
  assert.equal(Number(updated.revision), Number(first.revision) + 1);
  assert.equal(updated.created_at.toISOString(), first.created_at.toISOString());
  await db.query("DELETE FROM google_calendar_sync_queue WHERE task_id=$1 AND revision=$2", [task, first.revision]);
  assert.equal((await db.query("SELECT * FROM google_calendar_sync_queue")).rows.length, 1, "older worker cannot erase newer edit");
  await db.query("INSERT INTO tasks(id,user_id,title) VALUES ($1,$2,'Other user')", [another, b]);
  assert.equal((await db.query("SELECT * FROM google_calendar_sync_queue WHERE user_id=$1", [b])).rows.length, 0);
  assert.equal((await db.query("SELECT google_calendar_claim_lock($1,$2,300) AS claimed", [b, tokenB])).rows[0].claimed, true, "initial OAuth callback can lock before creating a connection");
  assert.equal((await db.query("SELECT google_calendar_release_lock($1,$2) AS released", [b, tokenB])).rows[0].released, true);

  await db.query("INSERT INTO google_calendar_task_events(user_id,task_id,calendar_id,event_id) VALUES ($1,$2,'actual-calendar','org-event')", [a, task]);
  await db.query("DELETE FROM tasks WHERE id=$1", [task]);
  assert.equal((await db.query("SELECT * FROM google_calendar_task_events")).rows.length, 1, "deleted task retains Google tombstone mapping");
  assert.equal((await db.query("SELECT * FROM google_calendar_sync_queue")).rows.length, 1);
  assert.equal((await db.query("SELECT google_calendar_claim_lock($1,$2,300) AS claimed", [a, tokenA])).rows[0].claimed, true);
  assert.equal((await db.query("SELECT google_calendar_claim_lock($1,$2,300) AS claimed", [a, tokenB])).rows[0].claimed, false);
  assert.equal((await db.query("SELECT google_calendar_claim_lock($1,$2,300) AS claimed", [a, tokenA])).rows[0].claimed, true, "owner can renew lease");
  assert.equal((await db.query("SELECT google_calendar_release_lock($1,$2) AS released", [a, tokenB])).rows[0].released, false);
  assert.equal((await db.query("SELECT google_calendar_release_lock($1,$2) AS released", [a, tokenA])).rows[0].released, true);
  await db.query("SELECT google_calendar_select_calendar($1,$2,$3)", [a, "new-calendar", "Trabalho"]);
  assert.equal((await db.query("SELECT calendar_id FROM google_calendar_connections WHERE user_id=$1", [a])).rows[0].calendar_id, "new-calendar");
  assert.equal((await db.query("SELECT * FROM google_calendar_sync_queue WHERE user_id=$1", [a])).rows.length, 1, "calendar change queues deleted-task mappings atomically");
  assert.equal((await db.query("SELECT calendar_id FROM google_calendar_task_events WHERE user_id=$1", [a])).rows[0].calendar_id, "actual-calendar", "old mapping remains until durable move completes");

  await db.query("INSERT INTO google_calendar_connections(user_id,google_account_id,refresh_token_encrypted,reconnect_required) VALUES ($1,'account-b','test-ciphertext',true)", [b]);
  await db.query("SELECT google_calendar_enqueue_all($1)", [b]);
  assert.deepEqual((await db.query("SELECT * FROM google_calendar_due_users(now(),20)")).rows.map((r) => r.user_id), [a]);
  await db.query("UPDATE google_calendar_connections SET reconnect_required=false WHERE user_id=$1", [b]);
  assert.equal((await db.query("SELECT * FROM google_calendar_due_users(now(),20)")).rows.length, 2, "one user cannot occupy every due-user slot");

  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role};`);
    for (const table of ["google_calendar_connections", "google_calendar_oauth_states", "google_calendar_task_events", "google_calendar_sync_queue", "google_calendar_user_locks"]) {
      await assert.rejects(db.query(`SELECT * FROM public.${table}`), /permission denied/);
    }
    await assert.rejects(db.query("SELECT google_calendar_enqueue_all($1)", [a]), /permission denied/);
    await assert.rejects(db.query("SELECT google_calendar_disconnect($1)", [a]), /permission denied/);
    await assert.rejects(db.query("SELECT google_calendar_select_calendar($1,'other','Other')", [a]), /permission denied/);
    await assert.rejects(db.query("SELECT configure_google_calendar_worker('https://project.supabase.co','not-a-secret')"), /permission denied/);
    await db.exec("RESET ROLE;");
  }
  await db.exec("SET ROLE authenticated;");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [b]);
  await db.query("UPDATE tasks SET title='Authenticated edit' WHERE id=$1", [another]);
  await assert.rejects(db.query("INSERT INTO tasks(id,user_id,title) VALUES ($1,$2,'Cross-owner')", [task, a]), /row-level security/);
  await db.exec("RESET ROLE;");
  assert.equal((await db.query("SELECT * FROM google_calendar_sync_queue WHERE user_id=$1", [b])).rows.length, 1, "task trigger works without exposing its function");

  await db.query("SELECT google_calendar_disconnect($1)", [a]);
  assert.equal((await db.query("SELECT * FROM google_calendar_connections WHERE user_id=$1", [a])).rows.length, 0);
  assert.equal((await db.query("SELECT * FROM google_calendar_sync_queue WHERE user_id=$1", [a])).rows.length, 0);
  assert.equal((await db.query("SELECT * FROM google_calendar_task_events WHERE user_id=$1", [a])).rows.length, 1, "disconnect keeps event IDs for duplicate-free reconnect");
  await db.query("INSERT INTO tasks(id,user_id,title) VALUES ($1,$2,'Disconnected task')", [task, a]);
  assert.equal((await db.query("SELECT * FROM google_calendar_sync_queue WHERE user_id=$1", [a])).rows.length, 0);
  await db.exec(migration);
  assert.equal((await db.query("SELECT * FROM google_calendar_task_events WHERE user_id=$1", [a])).rows.length, 1, "migration rerun preserves local records");
  console.log("PASS: migration, durable coalescing, revisions, deletion mappings, lease ownership, fair batching, token isolation, RLS, task triggers, disconnect and repeatability");
} finally {
  await db.close();
}
