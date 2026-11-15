begin;
-- Keep individual-account limits separate from the total number of workers.
alter table public.ig_publisher_connections add column publish_retry_at timestamptz not null default '-infinity';
create index ig_jobs_account_flow_head on public.ig_publication_jobs(account_id,flow_id,coalesce(flow_base_at,scheduled_at),id) where status='scheduled';
create index ig_jobs_processing_expiry on public.ig_publication_jobs(locked_at) where status='processing';
create index ig_jobs_uncertain_confirmation on public.ig_publication_jobs(next_attempt_at) where status='uncertain' and publish_started and container_id is not null;
create index x_posts_account_queue on public.x_posts(account_id,scheduled_at) where status='scheduled';
create index tiktok_posts_account_queue on public.tiktok_posts(account_id,scheduled_at) where status in ('scheduled','submitted');
CREATE OR REPLACE FUNCTION public.ig_claim_job_partition(p_token uuid, p_shard integer, p_shards integer)
 RETURNS SETOF ig_publication_jobs
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
begin
 if p_shards is null or p_shard is null or p_shards not between 1 and 8 or p_shard not between 0 and p_shards-1 then raise exception 'invalid_worker_partition'; end if;
 update public.ig_publication_jobs set status=case when publish_started then 'uncertain' else 'scheduled' end,error_code=case when publish_started then 'worker_interrupted' else null end where (hashtext(account_id::text)::bigint & 2147483647) % p_shards = p_shard and status='processing' and locked_at<now()-interval '10 minutes';
 return query
 with candidates as materialized (
  select head.id from public.ig_publisher_connections c
  cross join lateral (
   select distinct on (q.flow_id) q.id,q.flow_id,q.shared_account_owner
   from public.ig_publication_jobs q
   where q.account_id=c.account_id and q.account_owner=c.user_id and q.status='scheduled'
   and q.scheduled_at<=now() and q.next_attempt_at<=now()
   order by q.flow_id,coalesce(q.flow_base_at,q.scheduled_at),q.id
  ) head
  left join public.ig_flows f on f.id=head.flow_id
  where (hashtext(c.account_id::text)::bigint & 2147483647) % p_shards=p_shard
  and not c.paused and not c.reconnect_required and c.publish_retry_at<=now()
  and ((head.flow_id is null and head.shared_account_owner is null) or f.state='active')
  and not exists(select 1 from public.ig_publication_jobs busy where busy.account_id=c.account_id and busy.status='processing')
 )
 update public.ig_publication_jobs j set status='processing',lock_token=p_token,locked_at=now(),attempts=j.attempts+1
 where j.id=(select q.id from candidates candidate join public.ig_publication_jobs q on q.id=candidate.id join public.ig_publisher_connections c on c.account_id=q.account_id
 left join public.ig_flows f on f.id=q.flow_id
 where (hashtext(q.account_id::text)::bigint & 2147483647) % p_shards = p_shard and c.publish_retry_at<=now() and q.status='scheduled' and q.scheduled_at<=now() and q.next_attempt_at<=now() and c.user_id=q.account_owner and not c.paused and not c.reconnect_required and (q.flow_id is null or public.ig_flow_destination_ready(q.user_id,q.flow_id,q.account_id))
 and ((q.flow_id is null and q.shared_account_owner is null) or f.state='active')
 and not exists(select 1 from public.ig_publication_jobs prior where prior.account_id=q.account_id and prior.id<>q.id and prior.status='processing')
 and (q.flow_id is null or (
 not exists(select 1 from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status in ('failed','uncertain') and prior.media_urls && q.media_urls)
 and not exists(select 1 from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='scheduled' and not public.ig_flow_media_skipped(q.flow_id,q.account_id,prior.media_urls) and (coalesce(prior.flow_base_at,prior.scheduled_at),prior.id)<(coalesce(q.flow_base_at,q.scheduled_at),q.id))
 and coalesce((select max(prior.published_at) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published'),'-infinity'::timestamptz)
 + make_interval(secs => (case when coalesce((f.settings->>'gapPostDelay')::boolean,false) and coalesce(f.settings->>'schedule','gap')='gap' then 3 else (f.settings->>'gapMinutes')::double precision end)*60 + case when coalesce((f.settings->>'restMinutes')::double precision,0)>0 and (select count(*) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published')>0
 and (select count(*) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published') % coalesce((f.settings->>'batchSize')::integer,500)=0 then coalesce((f.settings->>'restMinutes')::double precision,0)*60 else 0 end)<=now()))
 order by q.scheduled_at,q.id for update of q,c skip locked limit 1) returning j.*;
exception when unique_violation then
 -- A concurrent transaction won the account lease after this snapshot.
 return;
end; $function$;

revoke all on function public.ig_claim_job_partition(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.ig_claim_job_partition(uuid,integer,integer) to service_role;

-- Legacy callers retain the same atomic claim and account exclusivity.
create or replace function public.ig_claim_job(p_token uuid) returns setof public.ig_publication_jobs
language sql security invoker set search_path='' as $$ select * from public.ig_claim_job_partition(p_token,0,1); $$;

create function public.x_due_accounts_partition(p_shard integer,p_shards integer)
returns table(account_id uuid,user_id uuid) language plpgsql security invoker set search_path='' as $$
begin
 if p_shards is null or p_shard is null or p_shards not between 1 and 8 or p_shard not between 0 and p_shards-1 then raise exception 'invalid_worker_partition'; end if;
 return query select a.id,a.user_id from public.x_accounts a
 join public.x_posts p on p.account_id=a.id
 where not a.paused and not a.reconnect_required and (a.locked_until is null or a.locked_until<now())
 and (hashtext(a.id::text)::bigint & 2147483647) % p_shards = p_shard and p.status='scheduled' and p.scheduled_at<=now()
 group by a.id,a.user_id order by min(p.scheduled_at),a.id limit 120;
end; $$;
revoke all on function public.x_due_accounts_partition(integer,integer) from public,anon,authenticated;
grant execute on function public.x_due_accounts_partition(integer,integer) to service_role;

create function public.tiktok_due_accounts_partition(p_shard integer,p_shards integer)
returns table(account_id uuid,user_id uuid) language plpgsql security invoker set search_path='' as $$
begin
 if p_shards is null or p_shard is null or p_shards not between 1 and 8 or p_shard not between 0 and p_shards-1 then raise exception 'invalid_worker_partition'; end if;
 return query select a.id,a.user_id from public.tiktok_accounts a
 join public.tiktok_posts p on p.account_id=a.id
 where not a.paused and not a.reconnect_required and (a.locked_until is null or a.locked_until<now())
 and (hashtext(a.id::text)::bigint & 2147483647) % p_shards = p_shard and ((p.status='scheduled' and p.scheduled_at<=now()) or p.status='submitted')
 group by a.id,a.user_id order by min(p.scheduled_at),a.id limit 120;
end; $$;
revoke all on function public.tiktok_due_accounts_partition(integer,integer) from public,anon,authenticated;
grant execute on function public.tiktok_due_accounts_partition(integer,integer) to service_role;

-- Only one maintenance request can run, even when cron deliveries overlap.
create table public.publisher_maintenance_lease (
 singleton boolean primary key default true check(singleton), token uuid not null, expires_at timestamptz not null
);
alter table public.publisher_maintenance_lease enable row level security;
revoke all on public.publisher_maintenance_lease from public,anon,authenticated;
grant all on public.publisher_maintenance_lease to service_role;
create function public.publisher_claim_maintenance(p_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 insert into public.publisher_maintenance_lease(singleton,token,expires_at)
 values(true,p_token,now()+interval '5 minutes') on conflict(singleton) do update
 set token=excluded.token,expires_at=excluded.expires_at where publisher_maintenance_lease.expires_at<now();
 return found;
end; $$;
create function public.publisher_release_maintenance(p_token uuid) returns void
language sql security invoker set search_path='' as $$ delete from public.publisher_maintenance_lease where token=p_token; $$;
revoke all on function public.publisher_claim_maintenance(uuid),public.publisher_release_maintenance(uuid) from public,anon,authenticated;
grant execute on function public.publisher_claim_maintenance(uuid),public.publisher_release_maintenance(uuid) to service_role;
commit;
