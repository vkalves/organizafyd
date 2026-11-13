// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const admin = "00000000-0000-4000-8000-000000000001";
const existing = "00000000-0000-4000-8000-000000000002";
const pending = "00000000-0000-4000-8000-000000000003";
let db: PGlite;
const query = async (sql: string, args: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, args)).rows;
const status = async (id: string) => (await query("select public.avanca_account_status($1) as status", [id]))[0].status;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key,email text,created_at timestamptz default now());
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.profiles(user_id uuid unique,display_name text);
    create table public.ig_publisher_connections(account_id uuid primary key,user_id uuid references auth.users(id));
    create table public.notes(user_id uuid,body text); alter table public.notes enable row level security;
    grant all on public.notes to authenticated;
    create policy own_notes on public.notes to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
    create schema avanca_storage_private;
    create function avanca_storage_private.limit_bytes(uuid) returns bigint language sql as $$ select 1073741824::bigint $$;
    create function avanca_storage_private.used_bytes(uuid) returns bigint language sql as $$ select 0::bigint $$;
    create function public.avanca_storage_access(uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
  `);
  await db.exec(readFileSync(new URL("../../../supabase/migrations/20261112223428_administration_and_instagram_account_limits.sql", import.meta.url), "utf8"));
  await query("insert into auth.users(id) values($1),($2)", [admin, existing]);
  await query("insert into public.avanca_admins(user_id) values($1)", [admin]);
  await db.exec(readFileSync(new URL("../../../supabase/migrations/20261113001901_account_approval.sql", import.meta.url), "utf8"));
  await query("insert into auth.users(id,email) values($1,'new@example.test')", [pending]);
}, 30000);
afterAll(async () => { await db?.close(); });
describe.sequential("new account approval enforced by Postgres", () => {
  it("preserves existing users and makes new accounts pending regardless of profile data", async () => {
    expect(await status(admin)).toBe("approved"); expect(await status(existing)).toBe("approved"); expect(await status(pending)).toBe("pending");
    expect(await status(crypto.randomUUID())).toBe("pending");
    const result = await query("select public.avanca_admin_pending_accounts($1) as queue", [admin]);
    expect(result[0].queue).toMatchObject({ total: 1, users: [{ id: pending, account_status: "pending" }] });
  });
  it("blocks pending users through direct RLS writes and reads and prevents self-approval", async () => {
    await query("insert into public.notes values($1,'private')", [pending]);
    await query("select set_config('request.jwt.claim.sub',$1,false)", [pending]);
    await db.exec("set role authenticated");
    try {
      expect(await query("select * from public.notes")).toEqual([]);
      await expect(query("insert into public.notes values($1,'bypass')", [pending])).rejects.toThrow(/row-level security/);
      await expect(query("update public.avanca_account_approvals set status='approved' where user_id=$1", [pending])).rejects.toThrow(/permission denied/);
      await expect(query("select public.avanca_admin_review_account($1,$1,'approved')", [pending])).rejects.toThrow(/permission denied/);
    } finally { await db.exec("reset role"); }
    await expect(query("insert into public.ig_publisher_connections values($1,$2)", [crypto.randomUUID(), pending])).rejects.toThrow("account_not_approved");
  });
  it("requires an administrator and validates decisions", async () => {
    await expect(query("select public.avanca_admin_review_account($1,$2,'approved')", [existing, pending])).rejects.toThrow("forbidden");
    await expect(query("select public.avanca_admin_pending_accounts($1)", [existing])).rejects.toThrow("forbidden");
    await expect(query("select public.avanca_admin_review_account($1,$2,'invalid')", [admin, pending])).rejects.toThrow("invalid_approval");
    await expect(query("select public.avanca_admin_review_account($1,$2,'rejected')", [admin, admin])).rejects.toThrow("account_not_pending");
  });
  it("records a rejection, removes it from the queue, and allows a later approval", async () => {
    await query("select public.avanca_admin_review_account($1,$2,'rejected')", [admin, pending]);
    expect(await status(pending)).toBe("rejected");
    expect((await query("select public.avanca_admin_pending_accounts($1) as queue", [admin]))[0].queue).toMatchObject({ total: 0, users: [] });
    await query("select public.avanca_admin_review_account($1,$2,'approved')", [admin, pending]);
    expect(await status(pending)).toBe("approved");
    expect((await query("select reviewed_by,reviewed_at from public.avanca_account_approvals where user_id=$1", [pending]))[0]).toMatchObject({ reviewed_by: admin, reviewed_at: expect.any(Date) });
    await expect(query("select public.avanca_admin_review_account($1,$2,'rejected')", [admin, pending])).rejects.toThrow("account_not_pending");
    await query("select set_config('request.jwt.claim.sub',$1,false)", [pending]);
    await db.exec("set role authenticated");
    try { expect((await query("select * from public.notes")).length).toBe(1); }
    finally { await db.exec("reset role"); }
    await query("insert into public.ig_publisher_connections values($1,$2)", [crypto.randomUUID(), pending]);
    expect((await query("select public.avanca_user_access($1) as access", [pending]))[0].access).toMatchObject({ account_status: "approved" });
    expect((await query("select public.avanca_admin_users($1) as directory", [admin]))[0].directory).toMatchObject({ users: expect.arrayContaining([expect.objectContaining({ id: pending, account_status: "approved" })]) });
  });
});
