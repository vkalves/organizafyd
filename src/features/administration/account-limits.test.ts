// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
const admin = "00000000-0000-4000-8000-000000000001";
const user = "00000000-0000-4000-8000-000000000002";
const other = "00000000-0000-4000-8000-000000000003";
let db: PGlite;
async function rows<T = Record<string, unknown>>(sql: string, values: unknown[] = []) { return (await db.query<T>(sql, values)).rows; }
const policy = (allowed: boolean, max: number | null, target = user, actor = admin) => rows("select public.avanca_admin_update_access($1,$2,$3,$4)", [actor, target, allowed, max]);
const connect = (target = user, account = crypto.randomUUID()) => rows("insert into public.ig_publisher_connections(account_id,user_id) values($1,$2) returning account_id", [account, target]);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key,email text,created_at timestamptz default now());
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.profiles(user_id uuid unique,display_name text);
    create table public.ig_publisher_connections(account_id uuid primary key,user_id uuid references auth.users(id),graph_id text);
  `);
  await db.exec(readFileSync(new URL("../../../supabase/migrations/20261112223428_administration_and_instagram_account_limits.sql", import.meta.url), "utf8"));
}, 30000);
beforeEach(async () => {
  await db.exec("truncate auth.users,public.avanca_admins,public.avanca_user_limits,public.ig_publisher_connections,public.profiles cascade");
  await db.query("insert into auth.users(id,email) values($1,'admin@example.test'),($2,'user@example.test'),($3,'other@example.test')", [admin,user,other]);
  await db.query("insert into public.avanca_admins(user_id) values($1)",[admin]);
});
afterAll(async () => { await db?.close(); });
describe("administrative account limits enforced by Postgres", () => {
  it("preserves unlimited access until a policy is set and counts connections per owner", async () => {
    await connect(); await connect(); await connect(other);
    expect((await rows("select public.avanca_user_access($1) as access",[user]))[0].access).toEqual({is_admin:false,connection_allowed:true,max_accounts:null,connected_accounts:2});
  });
  it("rejects new connections at the configured limit through any insert path", async () => {
    await policy(true,2); await connect(); await connect();
    await expect(connect()).rejects.toThrow("account_limit_reached");
    await connect(other);
    expect((await rows("select count(*)::int as n from public.ig_publisher_connections where user_id=$1",[user]))[0].n).toBe(2);
  });
  it("blocks new connections but permits updating or upserting an existing connection", async () => {
    const account = (await connect())[0].account_id;
    await policy(false,0);
    await expect(connect()).rejects.toThrow("account_connection_disabled");
    await db.query("update public.ig_publisher_connections set user_id=user_id,graph_id='refreshed' where account_id=$1",[account]);
    await db.query("insert into public.ig_publisher_connections(account_id,user_id,graph_id) values($1,$2,'renewed') on conflict(account_id) do update set graph_id=excluded.graph_id",[account,user]);
    expect((await rows("select graph_id from public.ig_publisher_connections where account_id=$1",[account]))[0].graph_id).toBe("renewed");
  });
  it("lowering a limit keeps existing accounts and freeing a slot permits a new connection", async () => {
    await connect(); await connect(); await policy(true,1);
    expect((await rows("select count(*)::int as n from public.ig_publisher_connections"))[0].n).toBe(2);
    await expect(connect()).rejects.toThrow("account_limit_reached");
    await db.query("delete from public.ig_publisher_connections where user_id=$1",[user]);
    await connect(); await expect(connect()).rejects.toThrow("account_limit_reached");
  });
  it("enforces the target owner's limit when ownership changes", async () => {
    const account=(await connect(other))[0].account_id;
    await policy(true,0);
    await expect(rows("update public.ig_publisher_connections set user_id=$1 where account_id=$2",[user,account])).rejects.toThrow("account_limit_reached");
  });
  it("rejects non-admin edits, invalid limits and unknown users", async () => {
    await expect(policy(true,5,user,other)).rejects.toThrow("forbidden");
    await expect(policy(true,-1)).rejects.toThrow("invalid_limit");
    await expect(policy(true,10001)).rejects.toThrow("invalid_limit");
    await expect(policy(true,2,crypto.randomUUID())).rejects.toThrow("user_not_found");
  });
  it("returns a searchable directory, real totals and current saved permissions", async () => {
    await connect(); await policy(false,3);
    const result=(await rows<{data:{users: {id:string;max_accounts:number;connected_accounts:number;connection_allowed:boolean}[];total:number;summary:unknown}}>("select public.avanca_admin_users($1,'user@',1) as data",[admin]))[0].data;
    expect(result.total).toBe(1); expect(result.summary).toEqual({users:3,accounts:1,blocked:1});
    expect(result.users[0]).toMatchObject({id:user,max_accounts:3,connected_accounts:1,connection_allowed:false});
    await expect(rows("select public.avanca_admin_users($1)",[other])).rejects.toThrow("forbidden");
  });
  it("supports the service role without granting direct access to auth.users", async () => {
    await db.exec("set role service_role");
    try {
      await expect(rows("select * from auth.users")).rejects.toThrow("permission denied");
      await policy(true,4);
      const directory=(await rows<{data:{total:number}}>("select public.avanca_admin_users($1) as data",[admin]))[0].data;
      expect(directory.total).toBe(3);
    } finally { await db.exec("reset role"); }
  });
  it("prevents browser roles from assigning admin access, changing limits or calling private RPCs", async () => {
    const privileges=await rows<{allowed:boolean}>(`select has_function_privilege('authenticated','public.avanca_admin_update_access(uuid,uuid,boolean,integer)','execute') as allowed
      union all select has_function_privilege('anon','public.avanca_admin_users(uuid,text,integer)','execute')
      union all select has_function_privilege('authenticated','public.avanca_user_access(uuid)','execute')
      union all select has_table_privilege('authenticated','public.avanca_admins','insert')
      union all select has_table_privilege('authenticated','public.avanca_user_limits','update')`);
    expect(privileges.every(p=>!p.allowed)).toBe(true);
    await policy(true,2); await policy(false,0,other);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${user}';`);
    try {
      expect((await rows("select user_id from public.avanca_user_limits")).map(r=>r.user_id)).toEqual([user]);
      await expect(rows("select * from public.avanca_admins")).rejects.toThrow("permission denied");
    } finally { await db.exec("reset role"); }
  });
});
