import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { PGlite } = await import(
  process.env.PGLITE_MODULE || "@electric-sql/pglite"
);
const db = new PGlite();
const user = "11111111-1111-1111-1111-111111111111";
const other = "22222222-2222-2222-2222-222222222222";
const a = "33333333-3333-3333-3333-333333333333";
const b = "44444444-4444-4444-4444-444444444444";
const lock = "55555555-5555-5555-5555-555555555555";
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1,'/') $$;
    GRANT USAGE ON SCHEMA public,storage,auth TO authenticated,anon,service_role;
    GRANT ALL ON storage.objects TO authenticated,service_role;
    CREATE SCHEMA vault; CREATE SCHEMA cron;
    CREATE TABLE vault.secrets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text UNIQUE,value text);
    CREATE FUNCTION vault.create_secret(value text,secret_name text) RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE result uuid; BEGIN INSERT INTO vault.secrets(name,value) VALUES(secret_name,value) RETURNING id INTO result; RETURN result; END; $$;
    CREATE FUNCTION vault.update_secret(secret_id uuid,new_value text) RETURNS void LANGUAGE sql AS $$ UPDATE vault.secrets SET value=new_value WHERE id=secret_id $$;
    CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY,jobname text,schedule text,command text);
    CREATE FUNCTION cron.schedule(job_name text,pattern text,job_command text) RETURNS bigint LANGUAGE plpgsql AS $$ DECLARE result bigint; BEGIN INSERT INTO cron.job(jobname,schedule,command) VALUES(job_name,pattern,job_command) RETURNING jobid INTO result; RETURN result; END; $$;
    CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN DELETE FROM cron.job WHERE jobid=job_id; RETURN FOUND; END; $$;
    INSERT INTO auth.users VALUES('${user}'),('${other}');
  `);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261016000000_x_publisher.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`INSERT INTO x_accounts(id,user_id,x_user_id,username,name,credentials,expires_at) VALUES
    ('${a}','${user}','1','first','First','encrypted',now()+interval '1 hour'),
    ('${b}','${other}','2','second','Second','encrypted',now()+interval '1 hour');
    INSERT INTO x_posts(id,user_id,account_id,text,scheduled_at) VALUES
    (gen_random_uuid(),'${user}','${a}','One',now()),(gen_random_uuid(),'${other}','${b}','Two',now());`);
  await assert.rejects(
    db.exec(
      `INSERT INTO x_posts(id,user_id,account_id,scheduled_at) VALUES(gen_random_uuid(),'${user}','${b}',now());`,
    ),
    /foreign key/,
  );
  assert.equal(
    (await db.query("SELECT * FROM x_due_accounts()")).rows.length,
    2,
  );
  await db.exec(`UPDATE x_accounts SET paused=true WHERE id='${a}';`);
  assert.deepEqual(
    (await db.query("SELECT account_id FROM x_due_accounts()")).rows,
    [{ account_id: b }],
  );
  await db.exec(
    `UPDATE x_accounts SET paused=false,reconnect_required=true WHERE id='${a}';`,
  );
  assert.equal(
    (await db.query("SELECT * FROM x_due_accounts()")).rows.length,
    1,
  );
  assert.equal(
    (await db.query("SELECT x_claim_account($1,$2) AS ok", [a, lock])).rows[0]
      .ok,
    true,
  );
  assert.equal(
    (
      await db.query("SELECT x_claim_account($1,$2) AS ok", [
        a,
        crypto.randomUUID(),
      ])
    ).rows[0].ok,
    false,
  );
  await db.query("SELECT x_release_account($1,$2)", [a, crypto.randomUUID()]);
  assert.equal(
    (
      await db.query("SELECT x_claim_account($1,$2) AS ok", [
        a,
        crypto.randomUUID(),
      ])
    ).rows[0].ok,
    false,
  );
  await db.query("SELECT x_release_account($1,$2)", [a, lock]);
  assert.equal(
    (
      await db.query("SELECT x_claim_account($1,$2) AS ok", [
        a,
        crypto.randomUUID(),
      ])
    ).rows[0].ok,
    true,
  );
  // Both cancellation and worker acquisition use this CAS; only the first can win.
  const changed = await db.query(
    `UPDATE x_posts SET status='processing',started_at=now() WHERE account_id=$1 AND status='scheduled' RETURNING id`,
    [a],
  );
  assert.equal(changed.rows.length, 1);
  assert.equal(
    (
      await db.query(
        `UPDATE x_posts SET status='cancelled' WHERE id=$1 AND status='scheduled' RETURNING id`,
        [changed.rows[0].id],
      )
    ).rows.length,
    0,
  );
  await db.query("SELECT configure_x_worker($1,$2)", [
    "https://project.supabase.co",
    "test-secret-at-least-thirty-two-characters",
  ]);
  await db.query("SELECT configure_x_worker($1,$2)", [
    "https://project.supabase.co",
    "test-secret-at-least-thirty-two-characters",
  ]);
  const jobs = (await db.query("SELECT * FROM cron.job")).rows;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].schedule, "* * * * *");
  assert.ok(jobs[0].command.includes("vault.decrypted_secrets"));
  assert.ok(!jobs[0].command.includes("test-secret-at-least"));
  await db.exec(
    `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',false);`,
  );
  for (const table of ["x_accounts", "x_oauth_states", "x_posts"])
    await assert.rejects(
      db.query(`SELECT * FROM ${table}`),
      /permission denied/,
    );
  await assert.rejects(
    db.query("SELECT x_claim_account($1,$2)", [a, lock]),
    /permission denied/,
  );
  await db.query(
    `INSERT INTO storage.objects(bucket_id,name) VALUES('x-media',$1)`,
    [`${user}/photo.jpg`],
  );
  await assert.rejects(
    db.query(
      `INSERT INTO storage.objects(bucket_id,name) VALUES('x-media',$1)`,
      [`${other}/photo.jpg`],
    ),
    /row-level security/,
  );
  assert.equal(
    (await db.query("SELECT * FROM storage.objects")).rows.length,
    1,
  );
  // No client delete policy: queued media cannot disappear under the worker.
  assert.equal(
    (await db.query("DELETE FROM storage.objects RETURNING id")).rows.length,
    0,
  );
  console.log(
    "X database checks passed: ownership, private tables, media RLS, queue filtering, locks, cancellation and scheduler.",
  );
} finally {
  await db.close();
}
