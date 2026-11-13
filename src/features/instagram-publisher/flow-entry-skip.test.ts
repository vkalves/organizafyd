// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const user='00000000-0000-4000-8000-000000000001', a='00000000-0000-4000-8000-000000000002', b='00000000-0000-4000-8000-000000000003', flow='00000000-0000-4000-8000-000000000004', m1='00000000-0000-4000-8000-000000000005', m2='00000000-0000-4000-8000-000000000006', guest='00000000-0000-4000-8000-000000000009';
let db:PGlite;
const rows=async<T=Record<string,unknown>>(sql:string,args:unknown[]=[]) => (await db.query<T>(sql,args)).rows;
const sync=async(owner=user)=> (await rows('select public.ig_sync_flow_accounts($1,$2,$3::uuid[],$4) as result',[user,flow,[b],owner]))[0].result;
const addJob=(media:string,minutes:number,status='scheduled')=>rows("insert into ig_publication_jobs(user_id,account_id,flow_id,format,caption,media_urls,scheduled_at,status) values($1,$2,$3,'Reel','Caption',array[$4],now()+make_interval(mins=>$5),$6)",[user,a,flow,media,minutes,status]);
const draft=(account:string,media='one.mp4',at='2027-01-01T12:00:00Z')=>({id:crypto.randomUUID(),account_id:account,media_urls:[media],format:'Reel',caption:'Caption',scheduled_at:at});
const append=(jobs:unknown[],cycle=1)=>rows('select public.ig_append_flow_cycle($1,$2,$3,$4::jsonb) as appended',[user,flow,cycle,JSON.stringify(jobs)]);
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create table ig_flows(id uuid primary key,user_id uuid,settings jsonb,state text default 'active',cycle integer default 1,last_error text);
 create table ig_publisher_connections(account_id uuid primary key,user_id uuid);
 create table ig_flow_library(id uuid primary key,user_id uuid,url text,retired boolean default false);
 create table ig_publication_jobs(id uuid primary key default gen_random_uuid(),user_id uuid,account_id uuid,caption text,format text,media_urls text[],scheduled_at timestamptz,next_attempt_at timestamptz default now(),flow_id uuid,cover_url text,flow_cycle integer default 1,shared_account_owner uuid,status text default 'scheduled',error_code text,published_at timestamptz);
 create function ig_flow_destination_ready(uuid,uuid,uuid) returns boolean language sql as $$ select exists(select 1 from public.ig_publisher_connections where account_id=$3) $$;
 create function ig_flow_media_skipped(uuid,uuid,text[]) returns boolean language sql as $$ select false $$;
 create function ig_sync_flow_accounts(uuid,uuid,uuid[],uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
 create function ig_append_flow_cycle(uuid,uuid,integer,jsonb) returns boolean language sql as $$ select false $$;
 create function ig_campaign_progress(uuid,uuid) returns table(account_id uuid,total bigint,last_at timestamptz) language sql as $$ select null::uuid,0::bigint,null::timestamptz where false $$;
 revoke all on function ig_sync_flow_accounts(uuid,uuid,uuid[],uuid),ig_append_flow_cycle(uuid,uuid,integer,jsonb),ig_campaign_progress(uuid,uuid) from public,anon,authenticated;
 grant execute on function ig_sync_flow_accounts(uuid,uuid,uuid[],uuid),ig_append_flow_cycle(uuid,uuid,integer,jsonb),ig_campaign_progress(uuid,uuid) to service_role;`);
 await db.exec(readFileSync(new URL('../../../supabase/migrations/20261113121349_skip_next_flow_post_on_account_entry.sql',import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{
 await db.exec('truncate ig_flows,ig_publisher_connections,ig_flow_library,ig_publication_jobs');
 await rows('insert into ig_flows(id,user_id,settings) values($1,$2,$3)',[flow,user,JSON.stringify({accountIds:[a],mediaIds:[m1,m2],distribution:'all',repeat:'loop',gapMinutes:120})]);
 await rows('insert into ig_publisher_connections values($1,$3),($2,$3)',[a,b,user]);
 await rows("insert into ig_flow_library(id,user_id,url) values($1,$3,'one.mp4'),($2,$3,'two.mp4')",[m1,m2,user]);
});
afterAll(async()=>{await db?.close();});
describe('new accounts skip the next active-flow slot once',()=>{
 it.each([20,90,240])('skips the next slot with %i minutes remaining and preserves existing jobs',async(minutes)=>{
  await addJob('one.mp4',minutes);await addJob('two.mp4',minutes+120);
  const before=await rows('select * from ig_publication_jobs order by id');
  expect(await sync()).toEqual({added:1,queued:1});
  const jobs=await rows<{status:string;media_urls:string[];error_code:string}>('select * from ig_publication_jobs where account_id=$1 order by scheduled_at',[b]);
  expect(jobs.map(j=>[j.media_urls[0],j.status,j.error_code])).toEqual([['one.mp4','cancelled','flow_entry_skipped'],['two.mp4','scheduled',null]]);
  expect(await rows('select * from ig_publication_jobs where account_id=$1 order by id',[a])).toEqual(before);
  expect(await sync()).toEqual({added:0,queued:0});
 });
 it('does not copy a processing publication or count it as the next upcoming slot',async()=>{
  await addJob('processing.mp4',-10,'processing');await addJob('one.mp4',20);await addJob('two.mp4',140);
  expect(await sync()).toEqual({added:1,queued:1});
  expect((await rows<{media_urls:string[]}>('select * from ig_publication_jobs where account_id=$1',[b])).flatMap(j=>j.media_urls)).not.toContain('processing.mp4');
 });
 it('skips the only remaining publication and begins normally in the following loop cycle',async()=>{
  await addJob('one.mp4',20);expect(await sync()).toEqual({added:1,queued:0});
  await db.exec("update ig_publication_jobs set status='published',published_at=now() where status='scheduled'");
  expect((await append([draft(a),draft(b)]))[0].appended).toBe(true);
  expect((await rows('select status from ig_publication_jobs where account_id=$1 and flow_cycle=2',[b]))[0].status).toBe('scheduled');
 });
 it('retains the skip until the next cycle when no posts are currently queued',async()=>{
  expect(await sync()).toEqual({added:1,queued:0});
  expect((await append([draft(a),draft(b),draft(b,'two.mp4','2027-01-01T14:00:00Z')]))[0].appended).toBe(true);
  expect((await rows('select status from ig_publication_jobs where account_id=$1 order by scheduled_at',[b])).map(j=>j.status)).toEqual(['cancelled','scheduled']);
  const settings=(await rows<{settings:{_entrySkipAccountIds:string[]}}>('select settings from ig_flows'))[0].settings;
  expect(settings._entrySkipAccountIds).toEqual([]);
 });
 it('uses a skipped single-item cycle as schedule anchor without counting it as a publication',async()=>{
  await sync();expect((await append([draft(b)]))[0].appended).toBe(true);
  const progress=(await rows<{total:number;last_at:Date}>('select * from ig_campaign_progress($1,$2)',[user,flow]))[0];
  expect(Number(progress.total)).toBe(0);expect(new Date(progress.last_at).toISOString()).toBe('2027-01-01T12:00:00.000Z');
  expect((await append([draft(b,'one.mp4','2027-01-01T14:00:00Z')],2))[0].appended).toBe(true);
  expect((await rows('select status from ig_publication_jobs where flow_cycle=3'))[0].status).toBe('scheduled');
 });
 it('applies the same rule to shared profiles without changing account ownership',async()=>{
  await rows('update ig_publisher_connections set user_id=$1 where account_id=$2',[guest,b]);
  await addJob('one.mp4',20);await addJob('two.mp4',140);expect(await sync(guest)).toEqual({added:1,queued:1});
  expect((await rows('select distinct shared_account_owner from ig_publication_jobs where account_id=$1',[b]))[0].shared_account_owner).toBe(guest);
 });
 it('keeps account validation, owner checks and privileged RPC permissions',async()=>{
  await expect(rows('select ig_sync_flow_accounts($1,$2,$3::uuid[],$1)',[guest,flow,[b]])).rejects.toThrow('invalid_flow');
  await db.exec("update ig_flows set state='stopped'");await expect(sync()).rejects.toThrow('campaign_not_active');
  expect((await rows("select has_function_privilege('authenticated','ig_sync_flow_accounts(uuid,uuid,uuid[],uuid)','execute') as allowed"))[0].allowed).toBe(false);
 });
});
