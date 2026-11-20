import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { MetaApp } from "./meta-apps";
let db: PGlite;
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const foreign = "33333333-3333-4333-8333-333333333333";
const migration = (name: string) => readFileSync(new NodeURL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8");
async function manage(action: string, id?: string) {
  const result = await db.query<{ apps: MetaApp[] }>("select public.ig_meta_apps_manage($1,$2,$3) as apps", [owner, action, JSON.stringify({ id })]);
  return result.rows[0].apps;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create schema vault; create table vault.secrets(id uuid primary key);
    create table public.ig_publisher_connections(user_id uuid);
    create table public.ig_connection_invites(id uuid);
    create table public.ig_login_states(id uuid);`);
  const original = migration("20261111211726_meta_apps_instagram_login.sql");
  await db.exec(original.slice(0, original.indexOf("create function public.ig_meta_app_config")));
  await db.exec(migration("20261120160925_default_meta_app.sql"));
}, 30000);
beforeEach(async () => {
  await db.exec(`truncate public.ig_meta_apps, public.ig_publisher_connections, public.ig_connection_invites, public.ig_login_states;
    insert into auth.users values ('${owner}'),('${other}') on conflict do nothing;
    insert into vault.secrets values ('${first}'),('${second}'),('${foreign}') on conflict do nothing;
    insert into public.ig_meta_apps(id,user_id,name,app_id,secret_id) values
    ('${first}','${owner}','Primeiro','12345','${first}'),
    ('${second}','${owner}','Segundo','67890','${second}'),
    ('${foreign}','${other}','Outro usuário','98765','${foreign}');`);
});
afterAll(async () => { await db.close(); });
it("persists only one default per owner and returns it in later requests", async () => {
  await manage("set_default", first);
  await manage("set_default", second);
  const apps = await manage("list");
  expect(apps.filter(app => app.isDefault).map(app => app.id)).toEqual([second]);
  expect(apps).toHaveLength(2);
  expect(JSON.stringify(apps)).not.toContain("secret_id");
});
it("rejects another owner's app, missing apps and inactive apps without losing the default", async () => {
  await manage("set_default", first);
  await expect(manage("set_default", foreign)).rejects.toThrow("app_not_found");
  await expect(manage("set_default")).rejects.toThrow("app_not_found");
  await manage("toggle", second);
  await expect(manage("set_default", second)).rejects.toThrow("app_not_found");
  expect((await manage("list")).find(app => app.isDefault)?.id).toBe(first);
});
it("clears a disabled default and preserves linked accounts", async () => {
  await db.query("insert into public.ig_publisher_connections(meta_app_id,user_id) values ($1,$2)", [second, owner]);
  await manage("set_default", second);
  const apps = await manage("toggle", second);
  expect(apps.some(app => app.isDefault)).toBe(false);
  expect((await db.query<{ meta_app_id: string }>("select meta_app_id from public.ig_publisher_connections")).rows[0].meta_app_id).toBe(second);
});
it("deletes a default without leaving a stale preference", async () => {
  await manage("set_default", second);
  const apps = await manage("delete", second);
  expect(apps.map(app => app.id)).toEqual([first]);
  expect(apps.some(app => app.isDefault)).toBe(false);
});
it("keeps the management RPC restricted to the authenticated edge function's service role", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try { await expect(manage("set_default", first)).rejects.toThrow("permission denied"); }
    finally { await db.exec("reset role"); }
  }
});
