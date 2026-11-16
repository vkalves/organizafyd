// Real Postgres concurrency test. Synthetic accounts only; no provider requests.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
const name=`organizafy-capacity-${process.pid}`;
function docker(args,input) {
 const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:10*1024*1024});
 if(r.status!==0) throw new Error(r.stderr||r.stdout);
 return r.stdout.trim();
}
const psql=sql=>docker(['exec','-i',name,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],sql);
const concurrent=sql=>new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',name,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1']);
 let output='',error=''; child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>error+=c);
 child.on('error',reject);child.on('close',code=>code?reject(new Error(error)):resolve(output.trim()));child.stdin.end(sql);
});
const migration=suffix=>readFileSync(new URL('../supabase/migrations/'+readdirSync(new URL('../supabase/migrations',import.meta.url)).find(f=>f.endsWith(suffix)),import.meta.url),'utf8');
try {
 docker(['run','--rm','-d','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine']);
 for(let i=0;i<100;i++) {
  if(spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],{stdio:'ignore'}).status===0) break;
  await new Promise(r=>setTimeout(r,100));
 }
 psql(readFileSync(new URL('../supabase/tests/fixtures/instagram-publisher-queue.sql',import.meta.url),'utf8'));
 psql(migration('_skip_next_flow_post_on_account_entry.sql'));
 psql(migration('_gap_account_delay.sql'));
 psql(migration('_scalable_instagram_flows.sql'));
 psql(`alter table ig_publication_jobs add column container_id text;
 create table x_accounts(id uuid primary key,user_id uuid,paused boolean default false,reconnect_required boolean default false,locked_until timestamptz,lock_token uuid);
 create table tiktok_accounts(like x_accounts including all);
 create table x_posts(id uuid primary key default gen_random_uuid(),account_id uuid,status text,scheduled_at timestamptz,started_at timestamptz,error_code text);
 create table tiktok_posts(like x_posts including all);
 create table x_oauth_states(expires_at timestamptz); create table tiktok_oauth_states(like x_oauth_states);
 create schema vault; create table vault.decrypted_secrets(name text,decrypted_secret text);
 insert into vault.decrypted_secrets values ('ig_worker_secret','synthetic'),('x_worker_secret','synthetic'),('tiktok_worker_secret','synthetic'),('x_project_url','https://test.supabase.co'),('tiktok_project_url','https://test.supabase.co');
 create schema cron; create table cron.job(jobname text primary key,schedule text,command text);
 insert into cron.job values('instagram-publisher','* * * * *','select net.http_post(url:=''https://test.supabase.co/functions/v1/instagram-publisher'')');
 create function cron.schedule(text,text,text) returns bigint language plpgsql as $$ begin insert into cron.job values($1,$2,$3) on conflict(jobname) do update set schedule=$2,command=$3; return 1; end; $$;
 create schema net; create table net.requests(id bigint generated always as identity,url text,body jsonb);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$ declare result bigint; begin insert into net.requests(url,body) values($1,$3) returning id into result; return result; end; $$;`);
 psql(migration('_publisher_capacity.sql'));
 psql(migration('_publisher_dispatch.sql'));
 psql(migration('_publisher_account_fairness.sql'));
 psql(`alter table ig_publication_jobs add column created_at timestamptz default now(),add column media_id text;
 alter table ig_flows add column created_at timestamptz default now();
 alter table ig_publisher_connections add column provider text default 'facebook',add column meta_app_id uuid;
 create table ig_meta_apps(id uuid,user_id uuid,app_id text);
 create table ig_flow_shared_accounts(flow_id uuid,account_id uuid,account_owner uuid);
 create function avanca_account_status(uuid) returns text language sql as $$ select 'approved'::text $$;`);
 psql(migration('_flow_queue_recovery.sql'));
 psql(`insert into ig_publisher_connections(account_id,user_id) select gen_random_uuid(),gen_random_uuid() from generate_series(1,1000);
 insert into ig_flows(id,user_id,settings) select account_id,user_id,'{"gapMinutes":3}' from ig_publisher_connections;
 insert into ig_publication_jobs(user_id,account_id,flow_id,caption,format,media_urls,scheduled_at)
 select c.user_id,c.account_id,c.account_id,'Synthetic caption','Reel',array['synthetic-'||i||'.mp4'],now()-interval '1 day'+i*interval '1 second'
 from ig_publisher_connections c cross join generate_series(1,100)i;
 insert into x_accounts(id,user_id,paused,reconnect_required,locked_until) select account_id,user_id,false,false,null from ig_publisher_connections;
 insert into tiktok_accounts select * from x_accounts;
 insert into x_posts(account_id,status,scheduled_at) select id,'scheduled',now()-interval '1 day' from x_accounts;
 insert into tiktok_posts(account_id,status,scheduled_at) select id,'submitted',now()-interval '1 day' from tiktok_accounts;
 analyze ig_publication_jobs; analyze ig_publisher_connections; analyze ig_flows;
 create table claimed_ids(id uuid primary key,account_id uuid unique,shard integer);
 create table claim_timings(ms double precision);`);
 assert.equal(psql('select count(*) from ig_publication_jobs'),'100000');
 if(process.env.CAPACITY_EXPLAIN) {
  const sql=migration('_publisher_capacity.sql');
  const query=sql.slice(sql.indexOf(' return query')+13,sql.indexOf('exception when unique_violation')).replace(/\bp_token\b/g,"gen_random_uuid()").replace(/\bp_shards\b/g,'8').replace(/\bp_shard\b/g,'0');
  console.log(psql('begin; explain(analyze,buffers) '+query+' rollback;'));
 }
 const started=performance.now();
 // 32 independent transactions compete across eight partitions. The unique
 // account lease must hold even when four lanes share the same partition.
 await Promise.all(Array.from({length:32},(_,lane)=>concurrent(`
 do $$ declare i integer; started timestamptz; begin for i in 1..5 loop
 started:=clock_timestamp();
 insert into claimed_ids select id,account_id,${lane%8} from ig_claim_job_partition(gen_random_uuid(),${lane%8},8);
 insert into claim_timings values(extract(epoch from clock_timestamp()-started)*1000);
 end loop; end; $$;`)));
 const elapsedMs=performance.now()-started;
 const claimed=Number(psql('select count(*) from claimed_ids'));
 assert.equal(claimed,160);
 assert.equal(psql("select count(*) from ig_publication_jobs where status='processing'"),'160');
 assert.equal(psql("select count(*) from claimed_ids where (hashtext(account_id::text)::bigint & 2147483647)%8<>shard"),'0');
 const timings=JSON.parse(psql('select json_build_object(\'p50_ms\',percentile_cont(.5) within group(order by ms),\'p95_ms\',percentile_cont(.95) within group(order by ms),\'max_ms\',max(ms)) from claim_timings'));
 // Global API backoff is enforced across all campaigns for that account.
 psql("update ig_publication_jobs set status='scheduled',locked_at=null,lock_token=null; update ig_publisher_connections set publish_retry_at=now()+interval '5 minutes'");
 assert.equal(psql('select count(*) from ig_claim_job_partition(gen_random_uuid(),0,1)'),'0');
 psql("update ig_publisher_connections set publish_retry_at='-infinity'");
 const lease=crypto.randomUUID(),other=crypto.randomUUID();
 assert.equal(psql(`select publisher_claim_maintenance('${lease}')`),'t');
 assert.equal(psql(`select publisher_claim_maintenance('${other}')`),'f');
 psql(`select publisher_release_maintenance('${other}')`);
 assert.equal(psql(`select publisher_claim_maintenance('${other}')`),'f');
 psql(`select publisher_release_maintenance('${lease}')`);
 assert.equal(psql(`select publisher_claim_maintenance('${other}')`),'t');
 for(const platform of ['x','tiktok']) {
  // Every account has exactly one partition, independently of the old 50 cap.
  const counts=psql(`select count(*),count(distinct account_id) from generate_series(0,7)shard cross join lateral ${platform}_due_accounts_partition(shard,8)`);
  const [all,distinct]=counts.split('|').map(Number);
  assert.equal(all,distinct); assert.ok(all>900&&all<=960);
 }
 // Recently visited accounts rotate behind accounts awaiting their first visit.
 for(const platform of ['x','tiktok']) {
  psql(`update ${platform}_accounts set last_worker_at=now() where id in(select account_id from ${platform}_due_accounts_partition(0,1))`);
  assert.equal(psql(`select count(*) from ${platform}_due_accounts_partition(0,1) d join ${platform}_accounts a on a.id=d.account_id where a.last_worker_at is not null`),'0');
 }
 assert.equal(psql("select has_function_privilege('anon','ig_claim_job_partition(uuid,integer,integer)','execute')"),'f');
 assert.equal(psql("select has_function_privilege('authenticated','publisher_dispatch(text)','execute')"),'f');
 const dispatch=JSON.parse(psql("select publisher_dispatch('instagram')")); assert.equal(dispatch.workers,8);
 assert.equal(psql("select count(distinct body->>'shard') from net.requests"),'8');
 psql('truncate ig_publication_jobs');
 assert.equal(JSON.parse(psql("select publisher_dispatch('instagram')")).workers,0);
 assert.equal(JSON.parse(psql("select publisher_dispatch('maintenance')")).workers,1);
 // Preserve campaign ordering, gap, pauses, and unrelated-flow progress.
 psql(`do $$ declare a record; f uuid:=gen_random_uuid(); claimed uuid; begin
 select * into a from ig_publisher_connections limit 1;
 insert into ig_flows(id,user_id,settings) values(f,a.user_id,'{"gapMinutes":3}');
 insert into ig_publication_jobs(user_id,account_id,flow_id,media_urls,scheduled_at,status,published_at)
 values(a.user_id,a.account_id,a.account_id,array['done.mp4'],now()-interval '1 minute','published',now()-interval '1 minute'),
 (a.user_id,a.account_id,a.account_id,array['blocked.mp4'],now()-interval '1 hour','scheduled',null),
 (a.user_id,a.account_id,f,array['ready.mp4'],now()-interval '1 minute','scheduled',null);
 select id into claimed from ig_claim_job_partition(gen_random_uuid(),0,1);
 if claimed is null or (select media_urls[1] from ig_publication_jobs where id=claimed)<>'ready.mp4' then raise exception 'Unrelated flow was blocked'; end if;
 update ig_publication_jobs set status='cancelled' where id=claimed;
 if exists(select 1 from ig_claim_job(gen_random_uuid())) then raise exception 'Gap was bypassed'; end if;
 update ig_publication_jobs set published_at=now()-interval '10 minutes' where status='published';
 update ig_flows set state='paused' where id=a.account_id;
 if exists(select 1 from ig_claim_job_partition(gen_random_uuid(),0,1)) then raise exception 'Paused flow claimed'; end if;
 update ig_flows set state='active' where id=a.account_id;
 if not exists(select 1 from ig_claim_job_partition(gen_random_uuid(),0,1)) then raise exception 'Active flow not claimed'; end if;
 end; $$;`);
 console.log(JSON.stringify({accounts:1000,queuedJobs:100000,concurrentWorkers:32,claims:claimed,elapsedMs:Math.round(elapsedMs),...timings,duplicateClaims:0,partitionOverlap:0,maintenanceLease:'passed',perAccountBackoff:'passed',accessControl:'passed',adaptiveDispatch:'passed',campaignScheduling:'passed',accountFairness:'passed'},null,2));
} finally { spawnSync('docker',['rm','-f',name],{stdio:'ignore'}); }
