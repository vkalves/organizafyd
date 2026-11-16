begin;
-- Additive operational state. No existing job is requeued by this migration.
alter table public.ig_publication_jobs
 add column container_checks integer not null default 0 check(container_checks>=0),
 add column last_error_details jsonb;

-- Authorization must be separate from temporary account readiness.
create function public.ig_flow_destination_authorized(p_user uuid,p_flow uuid,p_account uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.ig_publisher_connections c
 where c.account_id=p_account and (c.user_id=p_user or exists(
 select 1 from public.ig_flow_shared_accounts s join public.ig_flows f on f.id=s.flow_id
 where s.flow_id=p_flow and f.user_id=p_user and s.account_id=c.account_id
 and s.account_owner=c.user_id and public.avanca_account_status(s.account_owner)='approved')));
$$;

-- Called independently by minute maintenance, even when dispatch starts no workers.
create function public.ig_recover_publication_leases() returns integer
language plpgsql security invoker set search_path='' as $$
declare recovered integer;
begin
 with stale as (
  select id from public.ig_publication_jobs where status='processing'
  and locked_at<now()-interval '10 minutes'
  order by locked_at for update skip locked limit 250
 ), changed as (
  update public.ig_publication_jobs j set
   status=case when j.publish_started then 'uncertain'
    when not exists(select 1 from public.ig_publisher_connections c where c.account_id=j.account_id and c.user_id=j.account_owner)
     or (j.flow_id is not null and (not public.ig_flow_destination_authorized(j.user_id,j.flow_id,j.account_id)
       or not exists(select 1 from public.ig_flows f where f.id=j.flow_id and f.state in ('active','paused')))) then 'cancelled'
    else 'scheduled' end,
   error_code=case when j.publish_started then 'worker_interrupted' else null end,
   next_attempt_at=now()
  from stale where j.id=stale.id and j.status='processing' returning j.id
 ) select count(*) into recovered from changed;
 return recovered;
end;
$$;

-- Code 4 applies to an app, including connections owned by different users.
-- No tokens or app secrets are read. Reuse the existing per-account due gate.
create function public.ig_defer_publication_app(p_account uuid,p_retry_at timestamptz) returns integer
language plpgsql security invoker set search_path='' as $$
declare app_key text; affected integer;
begin
 if p_retry_at is null or p_retry_at<=now() or p_retry_at>now()+interval '1 day' then raise exception 'invalid_retry_time'; end if;
 select coalesce(a.app_id,'legacy:'||c.provider) into app_key
 from public.ig_publisher_connections c left join public.ig_meta_apps a on a.id=c.meta_app_id
 where c.account_id=p_account;
 if app_key is null then return 0; end if;
 with matching as (select c.account_id from public.ig_publisher_connections c
 left join public.ig_meta_apps a on a.id=c.meta_app_id
 where coalesce(a.app_id,'legacy:'||c.provider)=app_key)
 update public.ig_publisher_connections c set publish_retry_at=greatest(c.publish_retry_at,p_retry_at)
 from matching where c.account_id=matching.account_id;
 get diagnostics affected=row_count;
 return affected;
end;
$$;

revoke all on function public.ig_flow_destination_authorized(uuid,uuid,uuid),public.ig_recover_publication_leases(),public.ig_defer_publication_app(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.ig_flow_destination_authorized(uuid,uuid,uuid),public.ig_recover_publication_leases(),public.ig_defer_publication_app(uuid,timestamptz) to service_role;

CREATE OR REPLACE FUNCTION public.ig_campaign_due()
 RETURNS SETOF ig_flows
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 -- Resume only pauses caused by the old blanket failure rule, never a manual pause.
 update public.ig_flows f set state='active',last_error=null where state='paused' and last_error in ('publication_needs_review','no_available_accounts')
 and (exists(select 1 from public.ig_publication_jobs q where q.flow_id=f.id and q.status='scheduled'
 and public.ig_flow_destination_ready(f.user_id,f.id,q.account_id) and not public.ig_flow_media_skipped(f.id,q.account_id,q.media_urls))
 or (f.settings->>'repeat'='loop' and exists(select 1 from jsonb_array_elements_text(f.settings->'accountIds') ids(id)
 where public.ig_flow_destination_ready(f.user_id,f.id,ids.id::uuid))));
 -- Temporary health, pause or token problems suspend claims without deleting the queue.
 -- Only loss of authorization or a permanently excluded media pair cancels a job.
 update public.ig_publication_jobs q set status='cancelled',error_code=case
 when not public.ig_flow_destination_authorized(q.user_id,q.flow_id,q.account_id) then 'flow_access_revoked' else 'media_skipped_after_error' end
 from public.ig_flows f where q.flow_id=f.id and f.state='active' and q.status='scheduled'
 and (not public.ig_flow_destination_authorized(q.user_id,q.flow_id,q.account_id) or public.ig_flow_media_skipped(f.id,q.account_id,q.media_urls));
 update public.ig_flows f set state='completed',last_error=null where state='active' and coalesce(settings->>'repeat','once')='once'
 and not exists(select 1 from public.ig_publication_jobs j where j.flow_id=f.id and j.status in ('scheduled','processing'));
 update public.ig_flows f set state='paused',last_error='no_available_accounts' where state='active' and settings->>'repeat'='loop'
 and not exists(select 1 from jsonb_array_elements_text(f.settings->'accountIds') ids(id) where public.ig_flow_destination_ready(f.user_id,f.id,ids.id::uuid));
 return query select f.* from public.ig_flows f where state='active' and settings->>'repeat'='loop'
 and not exists(select 1 from public.ig_publication_jobs j where j.flow_id=f.id and j.status in ('scheduled','processing'))
 order by f.created_at limit 10;
end; $function$;

CREATE OR REPLACE FUNCTION public.ig_claim_job_partition(p_token uuid, p_shard integer, p_shards integer)
 RETURNS SETOF ig_publication_jobs
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
begin
 if p_shards is null or p_shard is null or p_shards not between 1 and 8 or p_shard not between 0 and p_shards-1 then raise exception 'invalid_worker_partition'; end if;
 perform public.ig_recover_publication_leases();
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
 + make_interval(secs => (case when f.settings->>'schedule'='slots' then 3 when coalesce((f.settings->>'gapPostDelay')::boolean,false) and coalesce(f.settings->>'schedule','gap')='gap' then 3 else (f.settings->>'gapMinutes')::double precision end)*60 + case when coalesce((f.settings->>'restMinutes')::double precision,0)>0 and (select count(*) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published')>0
 and (select count(*) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published') % coalesce((f.settings->>'batchSize')::integer,500)=0 then coalesce((f.settings->>'restMinutes')::double precision,0)*60 else 0 end)<=now()))
 order by q.scheduled_at,q.id for update of q,c skip locked limit 1) returning j.*;
exception when unique_violation then
 -- A concurrent transaction won the account lease after this snapshot.
 return;
end; $function$;


-- Operator-only, preview-first recovery. Never restores uncertain or attempted
-- cancelled publications. Preserve the selected account's original spacing.
create function public.ig_restore_flow_jobs(
 p_user uuid,p_flow uuid,p_accounts uuid[],p_kind text default 'account_unavailable',
 p_dry_run boolean default true,p_expected integer default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare campaign public.ig_flows; plan jsonb; eligible integer; changed integer; gap interval;
begin
 if p_accounts is null or cardinality(p_accounts) not between 1 and 50
  or array_position(p_accounts,null) is not null or p_kind is null
  or p_kind not in ('account_unavailable','transient_before_publish') or p_dry_run is null then raise exception 'invalid_recovery'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into campaign from public.ig_flows where id=p_flow and user_id=p_user for update;
 if not found or campaign.state<>'active' then raise exception 'campaign_not_active'; end if;
 if campaign.settings->>'schedule'='slots' then raise exception 'recovery_requires_slot_schedule'; end if;
 gap:=make_interval(secs=>greatest(3,coalesce((campaign.settings->>'gapMinutes')::double precision,3))*60);
 perform 1 from public.ig_publisher_connections where account_id=any(p_accounts) order by account_id for update;
 with candidates as materialized (
  select j.*,row_number() over(partition by j.account_id,j.media_urls order by j.scheduled_at,j.id) position
  from public.ig_publication_jobs j
  where j.user_id=p_user and j.flow_id=p_flow and j.account_id=any(p_accounts)
  and not j.publish_started and j.container_id is null and j.media_id is null and j.published_at is null
  and ((p_kind='account_unavailable' and j.status='cancelled' and j.error_code='account_unavailable' and j.attempts=0)
   or (p_kind='transient_before_publish' and j.status='failed' and j.error_code in ('meta_4','meta_17','meta_32','meta_613','meta_429','meta_500','meta_502','meta_503','meta_504','network_error','database_error')))
  and campaign.settings->'accountIds' @> jsonb_build_array(j.account_id::text)
  and public.ig_flow_destination_ready(p_user,p_flow,j.account_id)
  and exists(select 1 from public.ig_publisher_connections c where c.account_id=j.account_id and c.user_id=j.account_owner)
  and not exists(select 1 from unnest(j.media_urls) m(url) where not exists(
   select 1 from public.ig_flow_library l where l.user_id=p_user and l.url=m.url and not l.retired))
  and (j.cover_url is null or exists(select 1 from public.ig_flow_library l where l.user_id=p_user and l.url=j.cover_url and not l.retired))
  and not exists(select 1 from public.ig_publication_jobs other where other.id<>j.id and other.account_id=j.account_id and other.media_urls && j.media_urls
   and (other.status in ('scheduled','processing','uncertain')
    or (other.status='failed' and other.flow_id=j.flow_id)
    or (other.status='published' and (other.published_at>=j.created_at or (other.flow_id=j.flow_id and other.flow_cycle=j.flow_cycle)))))
 ), anchors as (
  select account_id,min(scheduled_at) first_original,
   greatest(now()+interval '5 minutes',
    coalesce((select max(q.scheduled_at) from public.ig_publication_jobs q where q.account_id=c.account_id and q.status in ('scheduled','processing')),'-infinity'::timestamptz)+gap,
    coalesce((select max(q.published_at) from public.ig_publication_jobs q where q.account_id=c.account_id and q.status='published'),'-infinity'::timestamptz)+gap
     +make_interval(secs=>coalesce((campaign.settings->>'restMinutes')::double precision,0)*60)) first_new
  from candidates c where position=1 group by account_id
 ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'account_id',c.account_id,
  'scheduled_at',c.scheduled_at+(a.first_new-a.first_original),
  'flow_base_at',coalesce(c.flow_base_at,c.scheduled_at)+(a.first_new-a.first_original)) order by c.account_id,c.scheduled_at,c.id),'[]'::jsonb)
 into plan from candidates c join anchors a using(account_id) where c.position=1;
 eligible:=jsonb_array_length(plan);
 if not p_dry_run then
  if p_expected is null or p_expected<>eligible then raise exception 'recovery_count_changed'; end if;
  update public.ig_publication_jobs j set status='scheduled',error_code=null,
   scheduled_at=p.scheduled_at,flow_base_at=p.flow_base_at,next_attempt_at=p.scheduled_at,
   locked_at=null,lock_token=null,container_checks=0
  from jsonb_to_recordset(plan) p(id uuid,scheduled_at timestamptz,flow_base_at timestamptz)
  where j.id=p.id and not j.publish_started and j.container_id is null
  and ((p_kind='account_unavailable' and j.status='cancelled' and j.error_code='account_unavailable' and j.attempts=0)
   or (p_kind='transient_before_publish' and j.status='failed'));
  get diagnostics changed=row_count;
  if changed<>eligible then raise exception 'recovery_count_changed'; end if;
 end if;
 return jsonb_build_object('dry_run',p_dry_run,'eligible',eligible,'restored',coalesce(changed,0),
  'accounts',coalesce((select jsonb_agg(x) from (
   select p.account_id,count(*) jobs,min(p.scheduled_at) first_at,max(p.scheduled_at) last_at
   from jsonb_to_recordset(plan) p(account_id uuid,scheduled_at timestamptz) group by p.account_id order by p.account_id) x),'[]'::jsonb));
end;
$$;
revoke all on function public.ig_restore_flow_jobs(uuid,uuid,uuid[],text,boolean,integer) from public,anon,authenticated;
grant execute on function public.ig_restore_flow_jobs(uuid,uuid,uuid[],text,boolean,integer) to service_role;

commit;
