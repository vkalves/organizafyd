// Isolated PostgreSQL regression: random per-account queues must not multiply slots.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const migration=readFileSync(process.argv[2] || new URL('../supabase/migrations/20261113133117_prevent_duplicate_instagram_flow_slots.sql', import.meta.url),'utf8');
const user=crypto.randomUUID(),flow=crypto.randomUUID();
const accounts=Array.from({length:4},()=>crypto.randomUUID());
await db.exec(`create table public.ig_flows(id uuid primary key,user_id uuid,state text,settings jsonb,cycle integer);
create table public.ig_publication_jobs(id uuid primary key,user_id uuid,account_id uuid,caption text,format text,media_urls text[],scheduled_at timestamptz,next_attempt_at timestamptz,flow_id uuid,cover_url text,flow_cycle integer default 0,shared_account_owner uuid,status text default 'scheduled',error_code text,flow_base_at timestamptz);
create function public.ig_flow_destination_ready(uuid,uuid,uuid) returns boolean language sql as $$ select true $$;
create function public.ig_flow_media_skipped(uuid,uuid,text[]) returns boolean language sql as $$ select false $$;`);
await db.query('insert into ig_flows values($1,$2,\'active\',$3,0)',[flow,user,JSON.stringify({accountIds:accounts.slice(0,3),mediaIds:['a','b','c'],distribution:'all',gapMinutes:60,gapPostDelay:true})]);
const base=Date.parse('2026-11-13T14:00:00Z');
for(let a=0;a<3;a++) for(let slot=0;slot<3;slot++) {
 const at=new Date(base+slot*3600000+a*5000).toISOString();
 await db.query(`insert into ig_publication_jobs(id,user_id,account_id,flow_id,caption,format,media_urls,scheduled_at,flow_base_at) values($1,$2,$3,$4,'','Reel',$5,$6,$6)`,[crypto.randomUUID(),user,accounts[a],flow,[`video-${a}-${slot}.mp4`],at]);
}
// Compile the changed function without applying the repair yet.
await db.exec(migration);
const {rows}=await db.query('select ig_sync_flow_accounts($1,$2,$3,$1) result',[user,flow,[accounts[3]]]);
assert.equal(rows[0].result.queued,2,'skip the entry slot and queue exactly one video per subsequent slot');
let jobs=(await db.query('select * from ig_publication_jobs where account_id=$1 order by flow_base_at',[accounts[3]])).rows;
assert.equal(jobs.length,3,'copy three time slots, not nine shuffled videos');
assert.equal(jobs[0].error_code,'flow_entry_skipped');
assert.equal(new Date(jobs[2].flow_base_at)-new Date(jobs[1].flow_base_at),3600000);
// Repeated account addition is idempotent.
assert.equal((await db.query('select ig_sync_flow_accounts($1,$2,$3,$1) result',[user,flow,[accounts[3]]])).rows[0].result.added,0);
await db.close();
console.log('PASS: random queues copy one video per slot; entry skip and repeated account addition are idempotent');
