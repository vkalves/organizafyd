// Run with: npm install --no-save @electric-sql/pglite && node scripts/test-instagram-db.mjs
// Temporary PostgreSQL-compatible database only; never connects to Supabase.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(
  `create schema auth; create role authenticated; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create function public.update_updated_at_column() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;`,
);
await db.exec(
  readFileSync(
    new URL(
      "../supabase/migrations/20260920000000_instagram.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
const a = "11111111-1111-1111-1111-111111111111",
  b = "22222222-2222-2222-2222-222222222222";
await db.exec(
  `insert into auth.users values ('${a}'),('${b}'); grant usage on schema public,auth to authenticated; grant all on all tables in schema public to authenticated; set role authenticated; select set_config('request.jwt.claim.sub','${a}',false);`,
);
const insert = async (table, cols, values) =>
  (
    await db.query(
      `insert into public.instagram_${table}(user_id,${cols}) values ($1,${values.map((_, i) => "$" + (i + 2)).join(",")}) returning id`,
      [a, ...values],
    )
  ).rows[0].id;
const project = await insert("projects", "name", ["Bianca"]);
const account = await insert("accounts", "username,name,project_id", [
  "bianca",
  "Bianca",
  project,
]);
await insert("tasks", "account_id,title", [account, "Publicar"]);
await insert("contents", "account_id,title", [account, "Reel"]);
await insert("metrics", "account_id,followers", [account, 12300]);
assert.equal(
  (await db.query("select * from instagram_history")).rows.length,
  4,
);
await db.query(
  `update instagram_metrics set followers=12450 where account_id=$1`,
  [account],
);
assert.equal(
  (
    await db.query(
      `select details->>'previous_followers' as old from instagram_history where action='instagram_metrics:update'`,
    )
  ).rows[0].old,
  "12300",
);
await assert.rejects(() =>
  insert("accounts", "username,name", ["bianca", "Duplicate"]),
);
await assert.rejects(() =>
  insert("contents", "account_id,title,status", [
    account,
    "No date",
    "published",
  ]),
);
await assert.rejects(() =>
  insert("metrics", "account_id,followers,recorded_on", [
    account,
    -1,
    "2026-01-01",
  ]),
);
await assert.rejects(() =>
  insert("history", "account_id,action", [account, "forged"]),
);
await db.exec(`select set_config('request.jwt.claim.sub','${b}',false)`);
assert.equal(
  (await db.query("select * from instagram_accounts")).rows.length,
  0,
);
assert.equal(
  (await db.query("select * from instagram_history")).rows.length,
  0,
);
await assert.rejects(() =>
  db.query(
    "insert into instagram_tasks(user_id,account_id,title) values ($1,$2,$3)",
    [b, account, "Cross owner"],
  ),
);
await assert.rejects(() =>
  db.query(
    "insert into instagram_accounts(user_id,username,name,project_id) values ($1,$2,$3,$4)",
    [b, "another", "Another", project],
  ),
);
await db.exec(`select set_config('request.jwt.claim.sub','${a}',false)`);
await db.query("delete from instagram_projects where id=$1", [project]);
assert.equal(
  (await db.query("select project_id from instagram_accounts")).rows[0]
    .project_id,
  null,
);
await db.query("delete from instagram_accounts where id=$1", [account]);
for (const table of ["tasks", "contents", "metrics", "history"])
  assert.equal(
    (await db.query(`select * from instagram_${table}`)).rows.length,
    0,
  );
console.log(
  "PASS: migration, RLS isolation, cross-owner references, validation, audit, project preservation, account cascades",
);
await db.close();
