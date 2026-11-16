// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
const u="00000000-0000-4000-8000-000000000001", a="00000000-0000-4000-8000-000000000002", f="00000000-0000-4000-8000-000000000003", other="00000000-0000-4000-8000-000000000004";
let db:PGlite;
const file=(name:string)=>readFileSync(new URL(`../../../supabase/${name}`,import.meta.url),"utf8");
const rows=async<T=Record<string,unknown>>(sql:string,args:unknown[]=[]) => (await db.query<T>(sql,args)).rows;
function definition(sql:string,name:string) {
 const start=sql.search(new RegExp(`create (or replace )?function public\\.${name}\\(`,"i"));
 const delimiter=sql.slice(start).match(/\$function\$|\$\$/)![0];
 const opening=sql.indexOf(delimiter,start),end=sql.indexOf(delimiter+';',opening+delimiter.length);
 return sql.slice(start,end+delimiter.length+1).replace(/create function/i,"create or replace function");
}
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(file("tests/fixtures/instagram-publisher-queue.sql"));
 await db.exec(`alter table ig_flows add column created_at timestamptz default now();
 alter table ig_publication_jobs add column flow_base_at timestamptz,add column container_id text,add column created_at timestamptz default now(),add column media_id text;
 alter table ig_publisher_connections add column publish_retry_at timestamptz default '-infinity',add column token_expires_at timestamptz,add column provider text default 'facebook',add column meta_app_id uuid;
 create table ig_account_health(account_id uuid,user_id uuid,state text);
 create table ig_flow_shared_accounts(flow_id uuid,account_id uuid,account_owner uuid);
 create table ig_meta_apps(id uuid,user_id uuid,app_id text);
 create function avanca_account_status(uuid) returns text language sql as $$ select 'approved'::text $$;
 create unique index one_processing on ig_publication_jobs(account_id) where status='processing';`);
 const old=file("migrations/20261112020647_isolate_flow_account_and_media_failures.sql");
 for(const name of ['ig_flow_account_ready','ig_flow_media_skipped']) await db.exec(definition(old,name));
 await db.exec(definition(file("migrations/20261113085700_share_active_instagram_flows.sql"),'ig_flow_destination_ready'));
 await db.exec(file("migrations/20261116191940_flow_queue_recovery.sql"));
},30000);
beforeEach(async()=>{
 await db.exec('truncate ig_publication_jobs,ig_flows,ig_publisher_connections,ig_account_health,ig_flow_shared_accounts,ig_meta_apps,ig_flow_library');
 await db.query('insert into ig_publisher_connections(account_id,user_id) values($1,$2)',[a,u]);
 await db.query('insert into ig_flows(id,user_id,settings) values($1,$2,$3)',[f,u,JSON.stringify({accountIds:[a],repeat:'once',gapMinutes:60})]);
});
afterAll(async()=>{await db?.close();});
const job=async(status='scheduled',extra='')=>rows(`insert into ig_publication_jobs(user_id,account_id,flow_id,media_urls,status,scheduled_at,next_attempt_at ${extra?',locked_at':''}) values($1,$2,$3,array['video.mp4'],$4,now()-interval '5 minutes',now()-interval '5 minutes' ${extra?','+extra:''}) returning id`,[u,a,f,status]);
describe('flow queue recovery in Postgres',()=>{
 it.each(['paused','reconnect','expired','health'])('preserves queued media across %s and resumes after recovery',async reason=>{
  await job();
  if(reason==='paused') await db.exec('update ig_publisher_connections set paused=true');
  if(reason==='reconnect') await db.exec('update ig_publisher_connections set reconnect_required=true');
  if(reason==='expired') await db.exec("update ig_publisher_connections set token_expires_at=now()-interval '1 day'");
  if(reason==='health') await db.query("insert into ig_account_health values($1,$2,'unavailable')",[a,u]);
  await rows('select id from ig_campaign_due()');
  expect((await rows('select state from ig_flows'))[0].state).toBe('active');
  expect((await rows('select status from ig_publication_jobs'))[0].status).toBe('scheduled');
  expect(await rows('select id from ig_claim_job_partition(gen_random_uuid(),0,1)')).toHaveLength(0);
  await db.exec("update ig_publisher_connections set paused=false,reconnect_required=false,token_expires_at=null;update ig_account_health set state='healthy'");
  await rows('select id from ig_campaign_due()');
  expect(await rows('select id from ig_claim_job_partition(gen_random_uuid(),0,1)')).toHaveLength(1);
 });
 it('keeps a manual campaign pause until explicitly resumed',async()=>{
  await job();await db.exec("update ig_flows set state='paused',last_error=null");await rows('select id from ig_campaign_due()');
  expect((await rows('select state from ig_flows'))[0].state).toBe('paused');
  expect((await rows('select status from ig_publication_jobs'))[0].status).toBe('scheduled');
 });
 it('retains loop work while every account is temporarily unavailable',async()=>{
  await job();await db.exec("update ig_flows set settings=settings||'{\"repeat\":\"loop\"}';update ig_publisher_connections set paused=true");
  await rows('select id from ig_campaign_due()');expect((await rows('select state from ig_flows'))[0].state).toBe('paused');
  await db.exec('update ig_publisher_connections set paused=false');await rows('select id from ig_campaign_due()');
  expect((await rows('select state from ig_flows'))[0].state).toBe('active');expect((await rows('select status from ig_publication_jobs'))[0].status).toBe('scheduled');
 });
 it('still cancels work after a shared destination loses authorization',async()=>{
  await db.query('update ig_publisher_connections set user_id=$1',[other]);
  await db.query('insert into ig_flow_shared_accounts values($1,$2,$3)',[f,a,other]);
  await job();await db.query('update ig_publication_jobs set shared_account_owner=$1',[other]);
  await db.exec('delete from ig_flow_shared_accounts');await rows('select id from ig_campaign_due()');
  expect((await rows('select status,error_code from ig_publication_jobs'))[0]).toEqual({status:'cancelled',error_code:'flow_access_revoked'});
 });
 it('recovers an expired lease without waiting for scheduled work to start a worker',async()=>{
  await job('processing',"now()-interval '11 minutes'");expect(await rows("select id from ig_publication_jobs where status='scheduled'")).toHaveLength(0);
  expect((await rows('select ig_recover_publication_leases() recovered'))[0].recovered).toBe(1);
  expect((await rows('select status from ig_publication_jobs'))[0].status).toBe('scheduled');
 });
 it('keeps an expired lease uncertain when media_publish may have started',async()=>{
  await job('processing',"now()-interval '11 minutes'");await db.exec('update ig_publication_jobs set publish_started=true');
  await rows('select ig_recover_publication_leases()');
  expect((await rows('select status,error_code from ig_publication_jobs'))[0]).toEqual({status:'uncertain',error_code:'worker_interrupted'});
  expect(await rows('select id from ig_claim_job_partition(gen_random_uuid(),0,1)')).toHaveLength(0);
 });
 it('never resumes an interrupted job of a stopped campaign',async()=>{
  await job('processing',"now()-interval '11 minutes'");await db.exec("update ig_flows set state='stopped'");await rows('select ig_recover_publication_leases()');
  expect((await rows('select status from ig_publication_jobs'))[0].status).toBe('cancelled');
 });
 it('ignores an unrelated GAP setting when a fixed slot is due',async()=>{
  await db.exec(`update ig_flows set settings=settings||'{"schedule":"slots"}';`);await job();
  await db.query("insert into ig_publication_jobs(user_id,account_id,flow_id,media_urls,status,scheduled_at,published_at) values($1,$2,$3,array['done.mp4'],'published',now()-interval '10 minutes',now()-interval '10 minutes')",[u,a,f]);
  expect(await rows('select id from ig_claim_job_partition(gen_random_uuid(),0,1)')).toHaveLength(1);
 });
 it('coordinates backoff across owners sharing one app without pausing a different app',async()=>{
  const b=crypto.randomUUID(),c=crypto.randomUUID(),appA=crypto.randomUUID(),appB=crypto.randomUUID(),appC=crypto.randomUUID();
  await db.query("insert into ig_meta_apps values($1,$4,'12345'),($2,$5,'12345'),($3,$5,'67890')",[appA,appB,appC,u,other]);
  await db.query('update ig_publisher_connections set meta_app_id=$1',[appA]);
  await db.query('insert into ig_publisher_connections(account_id,user_id,meta_app_id) values($1,$3,$4),($2,$3,$5)',[b,c,other,appB,appC]);
  expect((await rows("select ig_defer_publication_app($1,now()+interval '10 minutes') affected",[a]))[0].affected).toBe(2);
  expect((await rows('select account_id from ig_publisher_connections where publish_retry_at>now()')).map(x=>x.account_id).sort()).toEqual([a,b].sort());
 });
 it('does not expose administrative recovery or app gates to site users',async()=>{
  for(const signature of ['ig_flow_destination_authorized(uuid,uuid,uuid)','ig_recover_publication_leases()','ig_defer_publication_app(uuid,timestamptz)','ig_restore_flow_jobs(uuid,uuid,uuid[],text,boolean,integer)']) {
   expect((await rows('select has_function_privilege(\'authenticated\',$1,\'execute\') allowed',[signature]))[0].allowed).toBe(false);
   expect((await rows('select has_function_privilege(\'anon\',$1,\'execute\') allowed',[signature]))[0].allowed).toBe(false);
  }
 });
 it('previews recovery without modifying jobs and resumes only safe rows at their original spacing',async()=>{
  await db.query("insert into ig_flow_library(id,user_id,url) values(gen_random_uuid(),$1,'video.mp4'),(gen_random_uuid(),$1,'second.mp4')",[u]);
  await job('cancelled');await db.exec("update ig_publication_jobs set error_code='account_unavailable'");
  await db.query("insert into ig_publication_jobs(user_id,account_id,flow_id,media_urls,status,error_code,scheduled_at) values($1,$2,$3,array['second.mp4'],'cancelled','account_unavailable',now()+interval '55 minutes')",[u,a,f]);
  const call=(dry:boolean,expected:number|null=null)=>rows<{result:{eligible:number;restored:number}}>('select ig_restore_flow_jobs($1,$2,$3::uuid[],\'account_unavailable\',$4,$5) result',[u,f,[a],dry,expected]);
  expect((await call(true))[0].result.eligible).toBe(2);
  expect((await rows("select count(*)::int count from ig_publication_jobs where status='cancelled'"))[0].count).toBe(2);
  await expect(call(false,3)).rejects.toThrow('recovery_count_changed');
  expect((await call(false,2))[0].result.restored).toBe(2);
  const times=await rows<{scheduled_at:Date;next_attempt_at:Date;flow_base_at:Date}>('select scheduled_at,next_attempt_at,flow_base_at from ig_publication_jobs order by scheduled_at');
  expect(times[0].scheduled_at.getTime()).toBeGreaterThan(Date.now()+4*60000);
  expect(times[1].scheduled_at.getTime()-times[0].scheduled_at.getTime()).toBeGreaterThanOrEqual(59*60000);
  expect(times.every(t=>t.next_attempt_at.getTime()===t.scheduled_at.getTime())).toBe(true);
  expect((await call(true))[0].result.eligible).toBe(0);
 });
 it.each(['uncertain','published','processing','scheduled'])('refuses recovery when another %s publication already references the media',async status=>{
  await db.query("insert into ig_flow_library(id,user_id,url) values(gen_random_uuid(),$1,'video.mp4')",[u]);
  await job('cancelled');await db.exec("update ig_publication_jobs set error_code='account_unavailable'");
  await job(status);
  expect((await rows<{result:{eligible:number}}>('select ig_restore_flow_jobs($1,$2,$3::uuid[]) result',[u,f,[a]]))[0].result.eligible).toBe(0);
 });
 it('never restores cancelled jobs with a previous attempt, missing media or an unavailable destination',async()=>{
  await job('cancelled');await db.exec("update ig_publication_jobs set error_code='account_unavailable'");
  const count=async()=> (await rows<{result:{eligible:number}}>('select ig_restore_flow_jobs($1,$2,$3::uuid[]) result',[u,f,[a]]))[0].result.eligible;
  expect(await count()).toBe(0);
  await db.query("insert into ig_flow_library(id,user_id,url) values(gen_random_uuid(),$1,'video.mp4')",[u]);
  await db.exec('update ig_publication_jobs set attempts=1');expect(await count()).toBe(0);
  await db.exec('update ig_publication_jobs set attempts=0;update ig_publisher_connections set paused=true');expect(await count()).toBe(0);
 });
 it('can explicitly restore an exhausted transient failure only before publication and without a container',async()=>{
  await db.query("insert into ig_flow_library(id,user_id,url) values(gen_random_uuid(),$1,'video.mp4')",[u]);
  await job('failed');await db.exec("update ig_publication_jobs set error_code='meta_4',attempts=30");
  const count=async()=> (await rows<{result:{eligible:number}}>("select ig_restore_flow_jobs($1,$2,$3::uuid[],'transient_before_publish') result",[u,f,[a]]))[0].result.eligible;
  expect(await count()).toBe(1);
  await db.exec("update ig_publication_jobs set container_id='existing'");expect(await count()).toBe(0);
  await db.exec("update ig_publication_jobs set container_id=null,publish_started=true");expect(await count()).toBe(0);
 });
});
