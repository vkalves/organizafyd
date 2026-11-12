// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
const admin="00000000-0000-4000-8000-000000000001",user="00000000-0000-4000-8000-000000000002",other="00000000-0000-4000-8000-000000000003";
const GB=1024**3;
let db:PGlite;
async function rows<T=Record<string,unknown>>(sql:string,args:unknown[]=[]) { return (await db.query<T>(sql,args)).rows; }
const legacy=(owner:string,size:number,path:string=crypto.randomUUID(),bucket="media")=>rows("insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)",[bucket,`${owner}/${path}`,JSON.stringify({size})]);
const quota=(owner=user)=>rows<{data:{storage_limit_bytes:number|null;storage_used_bytes:number}}>("select public.avanca_storage_access($1) as data",[owner]).then(r=>r[0].data);
const limit=(bytes:number,owner=user,actor=admin)=>rows("select public.avanca_admin_update_storage($1,$2,$3)",[actor,owner,bytes]);
const reserve=(size:number,path:string=crypto.randomUUID(),owner=user,bucket="media")=>rows("select public.avanca_storage_reserve($1,$2,$3,$4)",[owner,bucket,`${owner}/${path}`,size]);
const sync=(objects:unknown[],owner=user)=>rows("select public.avanca_storage_sync($1,$2,now())",[owner,JSON.stringify(objects)]);
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create table auth.users(id uuid primary key,email text,created_at timestamptz default now());
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table public.profiles(user_id uuid unique,display_name text);
 create table public.ig_publisher_connections(account_id uuid primary key,user_id uuid references auth.users(id),graph_id text);
 create schema storage; create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
 grant usage on schema storage to service_role; grant select on storage.objects to service_role;`);
 for(const file of ["20261112223428_administration_and_instagram_account_limits.sql","20261112225249_default_ten_instagram_accounts.sql","20261112231231_user_media_storage_quotas.sql"])
  await db.exec(readFileSync(new URL(`../../../supabase/migrations/${file}`,import.meta.url),"utf8"));
},30000);
beforeEach(async()=>{
 await db.exec("truncate auth.users,public.avanca_admins,public.avanca_user_limits,public.avanca_storage_limits,public.ig_publisher_connections,public.profiles,storage.objects,avanca_storage_private.objects cascade");
 await rows("insert into auth.users(id,email) values($1,'admin@example.test'),($2,'user@example.test'),($3,'other@example.test')",[admin,user,other]);
 await rows("insert into public.avanca_admins(user_id) values($1)",[admin]);
});
afterAll(async()=>{await db?.close();});
describe("media storage quotas enforced by Postgres",()=>{
 it("defaults existing and new ordinary users to 1 GB while administrators are unlimited",async()=>{
  expect(await quota()).toEqual({storage_limit_bytes:GB,storage_used_bytes:0});
  expect((await quota(admin)).storage_limit_bytes).toBeNull();
  await legacy(admin,2*GB);
  await rows("insert into auth.users(id,email) values($1,'new@example.test')",[crypto.randomUUID()]);
  const directory=(await rows<{data:{users:{id:string;storage_limit_bytes:number|null}[]}}>("select public.avanca_admin_users($1) as data",[admin]))[0].data;
  expect(directory.users.filter(u=>u.id!==admin).every(u=>u.storage_limit_bytes===GB)).toBe(true);
  expect((await rows<{data:unknown}>("select public.avanca_user_access($1) as data",[user]))[0].data).toMatchObject({storage_limit_bytes:GB,storage_used_bytes:0,max_accounts:10});
 });
 it("combines every media bucket, accepts exactly the cap and isolates other users",async()=>{
  await legacy(user,GB/4,"a","media");await legacy(user,GB/4,"b","instagram-publisher");
  await legacy(user,GB/4,"c","x-media");await legacy(user,GB/4,"d","tiktok-media");
  expect((await quota()).storage_used_bytes).toBe(GB);
  await expect(legacy(user,1)).rejects.toThrow("storage_quota_exceeded");
  await legacy(other,GB);
 });
 it("supports upgrades, downgrades, zero allowance and audited admin-only updates",async()=>{
  await legacy(user,GB);await limit(2*GB);await legacy(user,GB);
  await limit(GB/2);expect((await quota()).storage_used_bytes).toBe(2*GB);
  await expect(legacy(user,1)).rejects.toThrow("storage_quota_exceeded");
  await rows("delete from storage.objects where name like $1",[`${user}/%`]);
  await limit(0);await expect(legacy(user,1)).rejects.toThrow("storage_quota_exceeded");
  expect((await rows("select updated_by from public.avanca_storage_limits"))[0].updated_by).toBe(admin);
  await expect(limit(GB,user,other)).rejects.toThrow("forbidden");
  await expect(limit(-1)).rejects.toThrow("invalid_storage_limit");
  await expect(limit(GB,admin)).rejects.toThrow("admin_storage_unlimited");
  await expect(limit(GB,crypto.randomUUID())).rejects.toThrow("user_not_found");
 });
 it("checks upserts and ownership transfers and permits metadata updates above a lowered limit",async()=>{
  await legacy(user,100,"a");await limit(50);
  await rows("update storage.objects set metadata=$1 where name=$2",[JSON.stringify({size:75,mimetype:"image/jpeg"}),`${user}/a`]);
  await expect(rows("update storage.objects set metadata=$1 where name=$2",[JSON.stringify({size:101}),`${user}/a`])).rejects.toThrow("storage_quota_exceeded");
  await legacy(other,100,"other");
  await expect(rows("update storage.objects set name=$1 where name=$2",[`${user}/moved`,`${other}/other`])).rejects.toThrow("storage_quota_exceeded");
 });
 it("reserves S3 bytes atomically across uploads and includes them in legacy API checks",async()=>{
  await limit(100);await reserve(60,"one");
  await expect(reserve(41,"two")).rejects.toThrow("storage_quota_exceeded");
  await expect(legacy(user,41)).rejects.toThrow("storage_quota_exceeded");
  await reserve(40,"two");expect((await quota()).storage_used_bytes).toBe(100);
  await expect(reserve(1,"one")).rejects.toThrow("upload_pending");
 });
 it("imports existing S3 files, counts migrated duplicates once, and never loses concurrent reservations",async()=>{
  await legacy(user,100,"a");await reserve(50,"pending");
  await sync([{bucket:"media",path:`${user}/a`,size_bytes:100},{bucket:"media",path:`${user}/old-s3`,size_bytes:200}]);
  expect((await quota()).storage_used_bytes).toBe(350);
  await expect(sync([{bucket:"media",path:`${other}/foreign`,size_bytes:1}])).rejects.toThrow();
 });
 it("releases abandoned reservations only after expiry and a complete inventory; deletion frees confirmed bytes",async()=>{
  await reserve(100,"abandoned");await sync([]);expect((await quota()).storage_used_bytes).toBe(100);
  await rows("update avanca_storage_private.objects set reserved_until=now()-interval '1 second'");
  await sync([]);expect((await quota()).storage_used_bytes).toBe(0);
  await sync([{bucket:"media",path:`${user}/confirmed`,size_bytes:100}]);
  await rows("select public.avanca_storage_removed('media',$1)",[[`${user}/confirmed`]]);
  expect((await quota()).storage_used_bytes).toBe(0);
 });
 it("keeps deleted pending bytes reserved while a signed POST could still recreate the file",async()=>{
  await reserve(100,"pending");
  await rows("select public.avanca_storage_removed('media',$1)",[[`${user}/pending`]]);
  expect((await quota()).storage_used_bytes).toBe(100);
 });
 it("does not restore deleted bytes from an older in-flight S3 inventory",async()=>{
  const objects=[{bucket:"media",path:`${user}/confirmed`,size_bytes:100}];
  await sync(objects);
  const started=(await rows<{started:string}>("select clock_timestamp()::text as started"))[0].started;
  await rows("select public.avanca_storage_removed('media',$1)",[[`${user}/confirmed`]]);
  await rows("select public.avanca_storage_sync($1,$2,$3)",[user,JSON.stringify(objects),started]);
  expect((await quota()).storage_used_bytes).toBe(0);
 });
 it("can pause and resume uploads for production inventory without affecting reads",async()=>{
  await db.exec(readFileSync(new URL("../../../supabase/migrations/20261112233234_storage_quota_rollout_pause.sql",import.meta.url),"utf8"));
  try {
   await expect(legacy(user,1)).rejects.toThrow("storage_maintenance");
   expect((await quota()).storage_limit_bytes).toBe(GB);
  } finally {
   await db.exec(readFileSync(new URL("../../../supabase/migrations/20261112233235_storage_quota_rollout_resume.sql",import.meta.url),"utf8"));
  }
  await legacy(user,1);
 });
 it("does not grant browsers access to quota updates, inventory or server RPCs",async()=>{
  for(const role of ["anon","authenticated"]) {
   const privileges=await rows<{allowed:boolean}>(`select has_function_privilege($1,'public.avanca_admin_update_storage(uuid,uuid,bigint)','execute') as allowed
    union all select has_function_privilege($1,'public.avanca_storage_reserve(uuid,text,text,bigint)','execute')
    union all select has_function_privilege($1,'public.avanca_storage_sync(uuid,jsonb,timestamptz)','execute')
    union all select has_function_privilege($1,'public.avanca_storage_access(uuid)','execute')
    union all select has_table_privilege($1,'public.avanca_storage_limits','update')`,[role]);
   expect(privileges.every(p=>!p.allowed)).toBe(true);
  }
  await db.exec("set role service_role");
  try {await limit(200);await reserve(100);expect((await quota()).storage_used_bytes).toBe(100);}
  finally {await db.exec("reset role");}
 });
});
