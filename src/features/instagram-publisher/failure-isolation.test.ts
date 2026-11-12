// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const user = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000009";
const a = "00000000-0000-4000-8000-000000000002";
const b = "00000000-0000-4000-8000-000000000003";
const flow = "00000000-0000-4000-8000-000000000004";
let db: PGlite;
async function rows<T = Record<string, unknown>>(sql: string, values: unknown[] = []) { return (await db.query<T>(sql, values)).rows; }
async function job(account: string, media: string, status = "scheduled", extra = "") {
  return (await rows<{ id: string }>(`insert into public.ig_publication_jobs(user_id,account_id,flow_id,media_urls,status,scheduled_at,next_attempt_at ${extra ? ",published_at" : ""}) values($1,$2,$3,array[$4],$5,now()-interval '1 hour',now()-interval '1 hour' ${extra ? "," + extra : ""}) returning id`, [user, account, flow, media, status]))[0].id;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.ig_flows(id uuid primary key,user_id uuid,name text,created_at timestamptz default now(),settings jsonb,state text default 'active',cycle integer default 1,last_error text);
    create table public.ig_publisher_connections(account_id uuid primary key,user_id uuid,paused boolean default false,reconnect_required boolean default false,token_expires_at timestamptz);
    create table public.ig_account_health(account_id uuid,user_id uuid,state text);
    create table public.ig_flow_library(id uuid primary key,user_id uuid,url text,retired boolean default false);
    create table public.ig_publication_jobs(id uuid primary key default gen_random_uuid(),user_id uuid,account_id uuid,flow_id uuid,media_urls text[],status text default 'scheduled',scheduled_at timestamptz,next_attempt_at timestamptz default now(),published_at timestamptz,locked_at timestamptz,lock_token uuid,attempts integer default 0,publish_started boolean default false,error_code text,caption text,format text,cover_url text,flow_cycle integer default 1);
  `);
  await db.exec(readFileSync(new URL("../../../supabase/migrations/20261112020647_isolate_flow_account_and_media_failures.sql", import.meta.url), "utf8"));
}, 30_000);
beforeEach(async () => {
  await db.exec("truncate public.ig_publication_jobs,public.ig_flows,public.ig_publisher_connections,public.ig_account_health,public.ig_flow_library");
  await db.query("insert into public.ig_publisher_connections(account_id,user_id) values($1,$3),($2,$3)", [a, b, user]);
  await db.query("insert into public.ig_flows(id,user_id,name,settings) values($1,$2,'Test',$3)", [flow,user,JSON.stringify({ accountIds: [a,b], mediaIds: [a,b], repeat: "once", gapMinutes: 3 })]);
  await db.query("insert into public.ig_flow_library(id,user_id,url) values($1,$3,'good.mp4'),($2,$3,'bad.mp4')",[a,b,user]);
});
afterAll(async () => { await db?.close(); });
describe("automatic flow failure isolation in Postgres", () => {
  it("resumes an old automatic pause, removes only the failed account/media pair, and claims another item", async () => {
    const failed = await job(a,"bad.mp4","failed");
    const skipped = await job(a,"bad.mp4");
    await job(a,"good.mp4"); await job(b,"bad.mp4");
    await db.exec("update public.ig_flows set state='paused',last_error='publication_needs_review'");
    await rows("select * from public.ig_campaign_due()");
    expect((await rows("select state from public.ig_flows"))[0].state).toBe("active");
    expect((await rows("select status from public.ig_publication_jobs where id=$1",[skipped]))[0].status).toBe("cancelled");
    expect((await rows("select status from public.ig_publication_jobs where id=$1",[failed]))[0].status).toBe("failed");
    const claimed = await rows("select * from public.ig_claim_job(gen_random_uuid())");
    expect(claimed).toHaveLength(1);
    expect(claimed[0].account_id === b || (claimed[0].media_urls as string[])[0] === "good.mp4").toBe(true);
  });
  it.each(["reconnect", "expired", "unavailable"])("automatically excludes a %s account while healthy accounts continue", async reason => {
    const skipped = await job(a,"good.mp4"); await job(b,"good.mp4");
    if (reason === "reconnect") await db.query("update public.ig_publisher_connections set reconnect_required=true where account_id=$1",[a]);
    if (reason === "expired") await db.query("update public.ig_publisher_connections set token_expires_at=now()-interval '1 second' where account_id=$1",[a]);
    if (reason === "unavailable") await db.query("insert into public.ig_account_health values($1,$2,'unavailable')",[a,user]);
    await rows("select * from public.ig_campaign_due()");
    expect((await rows("select status,error_code from public.ig_publication_jobs where id=$1",[skipped]))[0]).toEqual({status:"cancelled",error_code:"account_unavailable"});
    expect((await rows("select * from public.ig_claim_job(gen_random_uuid())"))[0].account_id).toBe(b);
  });
  it("never retries an uncertain upload but continues other media on the same account", async () => {
    const uncertain = await job(a,"bad.mp4","uncertain");
    await db.query("update public.ig_publication_jobs set publish_started=true where id=$1",[uncertain]);
    await job(a,"bad.mp4"); await job(a,"good.mp4");
    const claimed = await rows("select * from public.ig_claim_job(gen_random_uuid())");
    expect(claimed).toHaveLength(1);
    expect(claimed[0].media_urls).toEqual(["good.mp4"]);
    expect((await rows("select status,publish_started from public.ig_publication_jobs where id=$1",[uncertain]))[0]).toEqual({status:"uncertain",publish_started:true});
  });
  it("advances loop cycles despite failed attempts and prevents reintroducing a skipped media pair", async () => {
    await db.exec(`update public.ig_flows set settings=settings||'{"repeat":"loop"}'::jsonb`);
    await job(a,"bad.mp4","failed"); await job(b,"good.mp4","published","now()-interval '1 hour'");
    expect(await rows("select * from public.ig_campaign_due()")).toHaveLength(1);
    const runtime=(await rows<{runtime:{available:string[];excluded:{account_id:string;url:string}[]}}>("select public.ig_flow_runtime($1,$2) as runtime",[user,flow]))[0].runtime;
    expect(runtime.excluded).toEqual([{account_id:a,url:"bad.mp4"}]);
    const draft=(account_id:string,url:string)=>[{id:crypto.randomUUID(),account_id,media_urls:[url],format:"Reel",caption:"",scheduled_at:new Date(Date.now()+60000).toISOString()}];
    expect((await rows("select public.ig_append_flow_cycle($1,$2,1,$3) as appended",[user,flow,JSON.stringify(draft(a,"bad.mp4"))]))[0].appended).toBe(false);
    expect((await rows("select public.ig_append_flow_cycle($1,$2,1,$3) as appended",[user,flow,JSON.stringify(draft(b,"good.mp4"))]))[0].appended).toBe(true);
    expect((await rows("select cycle from public.ig_flows"))[0].cycle).toBe(2);
  });
  it("preserves deliberate pauses and the configured per-account publishing interval", async () => {
    await job(a,"bad.mp4","failed"); await job(a,"good.mp4");
    await db.exec("update public.ig_flows set state='paused',last_error=null");
    await rows("select * from public.ig_campaign_due()");
    expect(await rows("select * from public.ig_claim_job(gen_random_uuid())")).toHaveLength(0);
    await db.exec("update public.ig_flows set state='active'");
    await job(a,"previous.mp4","published","now()-interval '1 minute'");
    expect(await rows("select * from public.ig_claim_job(gen_random_uuid())")).toHaveLength(0);
  });
  it("does not expose the service helpers or another user's runtime", async () => {
    expect((await rows("select has_function_privilege('anon','public.ig_flow_runtime(uuid,uuid)','execute') as allowed"))[0].allowed).toBe(false);
    expect((await rows("select public.ig_flow_runtime($1,$2) as runtime",[other,flow]))[0].runtime).toBeNull();
    expect((await rows("select public.ig_flow_account_ready($1,$2) as ready",[other,a]))[0].ready).toBe(false);
  });
  it("waits only when every account is unavailable and resumes loop generation automatically when one recovers", async () => {
    await db.exec(`update public.ig_flows set settings=settings||'{"repeat":"loop"}'::jsonb`);
    await job(a,"good.mp4"); await job(b,"good.mp4");
    await db.exec("update public.ig_publisher_connections set reconnect_required=true");
    expect(await rows("select * from public.ig_campaign_due()")).toHaveLength(0);
    expect((await rows("select state,last_error from public.ig_flows"))[0]).toEqual({state:"paused",last_error:"no_available_accounts"});
    await db.query("update public.ig_publisher_connections set reconnect_required=false where account_id=$1",[b]);
    expect(await rows("select * from public.ig_campaign_due()")).toHaveLength(1);
    expect((await rows("select state from public.ig_flows"))[0].state).toBe("active");
  });
});
