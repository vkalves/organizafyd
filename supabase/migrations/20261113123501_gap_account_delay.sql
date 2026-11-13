begin;
alter table public.ig_publication_jobs add column flow_base_at timestamptz;
-- Each post gets an independent draw; retain nominal slots for skip/order/loops.
create or replace function public.ig_create_flow(p_user uuid,p_id uuid,p_name text,p_settings jsonb,p_jobs jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 if exists(select 1 from public.ig_flows where id=p_id and user_id=p_user) then
 if not exists(select 1 from public.ig_flows where id=p_id and user_id=p_user and settings=p_settings) then raise exception 'duplicate_conflict'; end if;
 return; end if;
 if jsonb_array_length(p_jobs) not between 1 and 500 then raise exception 'invalid_media'; end if;
 if exists(select 1 from jsonb_array_elements(p_jobs) j left join public.ig_publisher_connections c on c.account_id=(j->>'account_id')::uuid and c.user_id=p_user
 where c.account_id is null or c.paused or c.reconnect_required) then raise exception 'account_not_connected'; end if;
 if exists(select 1 from jsonb_array_elements(p_jobs) j where not exists(select 1 from public.ig_flow_library m where m.user_id=p_user and not m.retired and m.url=(j->'media_urls'->>0)) or (nullif(j->>'cover_url','') is not null and not exists(select 1 from public.ig_flow_library m where m.user_id=p_user and not m.retired and m.url=j->>'cover_url'))) then raise exception 'invalid_media_owner'; end if;
 insert into public.ig_flows(id,user_id,name,settings) values(p_id,p_user,p_name,p_settings);
 insert into public.ig_publication_jobs(id,user_id,account_id,caption,format,media_urls,scheduled_at,flow_id,cover_url,flow_base_at)
 select (j->>'id')::uuid,p_user,(j->>'account_id')::uuid,j->>'caption',j->>'format',
 array(select jsonb_array_elements_text(j->'media_urls')),(j->>'scheduled_at')::timestamptz,p_id,nullif(j->>'cover_url',''),(j->>'flow_base_at')::timestamptz
 from jsonb_array_elements(p_jobs) j;
end; $$;
CREATE OR REPLACE FUNCTION public.ig_sync_flow_accounts(p_user uuid, p_id uuid, p_accounts uuid[], p_account_owner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare f public.ig_flows; combined jsonb; additions uuid[]; media_count integer; queued integer; first_at timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into f from public.ig_flows where id=p_id and user_id=p_user for update;
 if not found then raise exception 'invalid_flow'; end if;
 if f.state<>'active' then raise exception 'campaign_not_active'; end if;
 if p_accounts is null or cardinality(p_accounts) not between 1 and 50 or array_position(p_accounts,null) is not null then raise exception 'invalid_accounts'; end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into additions from (select distinct id from unnest(p_accounts) ids(id) where not(f.settings->'accountIds' @> jsonb_build_array(id::text))) x;
 if cardinality(additions)=0 then return jsonb_build_object('added',0,'queued',0); end if;
 if exists(select 1 from unnest(additions) ids(id) where not public.ig_flow_destination_ready(p_user,p_id,ids.id)) then raise exception 'account_not_connected'; end if;
 combined:=(f.settings->'accountIds')||to_jsonb(additions);
 if jsonb_array_length(combined)>50 then raise exception 'invalid_accounts'; end if;
 if coalesce(f.settings->>'distribution','all')='all' and jsonb_array_length(combined)*jsonb_array_length(f.settings->'mediaIds')>500 then raise exception 'flow_too_large'; end if;
 select count(*) into media_count from (select distinct j.format,j.media_urls from public.ig_publication_jobs j where j.flow_id=p_id and j.user_id=p_user and j.status='scheduled') x;
 if media_count*cardinality(additions)>500 then raise exception 'flow_too_large'; end if;
 select min(coalesce(flow_base_at,scheduled_at)) into first_at from public.ig_publication_jobs
 where flow_id=p_id and user_id=p_user and status='scheduled';
 update public.ig_flows set settings=settings||jsonb_build_object('accountIds',combined,
 '_entrySkipAccountIds',coalesce(settings->'_entrySkipAccountIds','[]'::jsonb)||case when first_at is null then to_jsonb(additions) else '[]'::jsonb end) where id=p_id;
 with templates as (
 select distinct on (format,media_urls) caption,format,media_urls,coalesce(flow_base_at,scheduled_at) as base_at,cover_url
 from public.ig_publication_jobs where flow_id=p_id and user_id=p_user and status='scheduled'
 order by format,media_urls,coalesce(flow_base_at,scheduled_at),id
 ), candidates as materialized (
 select account.id as account_id,j.*,
 case when coalesce((f.settings->>'gapPostDelay')::boolean,false) and coalesce(f.settings->>'schedule','gap')='gap'
 then 60000 + floor(random()*240001)::integer else 0 end as delay_ms
 from unnest(additions) account(id) cross join templates j
 where not public.ig_flow_media_skipped(p_id,account.id,j.media_urls)
 and (not coalesce((f.settings->>'avoidReuse')::boolean,false) or not exists(
 select 1 from public.ig_publication_jobs prior where prior.user_id=p_user and prior.account_id=account.id
 and prior.media_urls && j.media_urls and prior.status in ('scheduled','processing','published','uncertain')
 and (prior.flow_id is distinct from p_id or prior.flow_cycle=f.cycle)))
 )
 insert into public.ig_publication_jobs(id,user_id,account_id,caption,format,media_urls,scheduled_at,next_attempt_at,flow_id,cover_url,flow_cycle,shared_account_owner,status,error_code,flow_base_at)
 select gen_random_uuid(),p_user,j.account_id,j.caption,j.format,j.media_urls,j.base_at+j.delay_ms*interval '1 millisecond',now(),p_id,j.cover_url,f.cycle,nullif(p_account_owner,p_user),
 case when j.base_at=first_at then 'cancelled' else 'scheduled' end,
 case when j.base_at=first_at then 'flow_entry_skipped' else null end,
 case when j.delay_ms>0 then j.base_at else null end
 from candidates j;
 select count(*) into queued from public.ig_publication_jobs where flow_id=p_id and account_id=any(additions) and status='scheduled';
 return jsonb_build_object('added',cardinality(additions),'queued',queued);
end; $function$;
CREATE OR REPLACE FUNCTION public.ig_append_flow_cycle(p_user uuid, p_id uuid, p_cycle integer, p_jobs jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare f public.ig_flows;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into f from public.ig_flows where id=p_id and user_id=p_user for update;
 if not found or f.state<>'active' or f.cycle<>p_cycle or coalesce(f.settings->>'repeat','once')<>'loop' then return false; end if;
 if exists(select 1 from public.ig_publication_jobs where flow_id=p_id and status in ('scheduled','processing')) then return false; end if;
 if jsonb_array_length(p_jobs) not between 1 and 500 then raise exception 'invalid_media'; end if;
 if exists(select 1 from jsonb_array_elements(p_jobs) j left join public.ig_publisher_connections c on c.account_id=(j->>'account_id')::uuid and public.ig_flow_destination_ready(p_user,p_id,c.account_id) where c.account_id is null or not (f.settings->'accountIds' @> jsonb_build_array(c.account_id::text)) or public.ig_flow_media_skipped(p_id,c.account_id,array(select jsonb_array_elements_text(j->'media_urls')))) then return false; end if;
 if exists(select 1 from jsonb_array_elements(p_jobs) j where not exists(select 1 from public.ig_flow_library m where m.user_id=p_user and not m.retired and m.id::text in (select jsonb_array_elements_text(f.settings->'mediaIds')) and m.url=j->'media_urls'->>0)) then raise exception 'invalid_media_owner'; end if;
 update public.ig_flows set cycle=cycle+1,last_error=null,settings=jsonb_set(settings,'{_entrySkipAccountIds}',
 coalesce((select jsonb_agg(ids.id) from jsonb_array_elements_text(coalesce(settings->'_entrySkipAccountIds','[]'::jsonb)) ids(id)
 where not exists(select 1 from jsonb_array_elements(p_jobs) job where job->>'account_id'=ids.id)),'[]'::jsonb)) where id=p_id;
 insert into public.ig_publication_jobs(id,user_id,account_id,caption,format,media_urls,scheduled_at,flow_id,cover_url,flow_cycle,shared_account_owner,status,error_code,flow_base_at)
 select (j->>'id')::uuid,p_user,(j->>'account_id')::uuid,j->>'caption',j->>'format',array(select jsonb_array_elements_text(j->'media_urls')),(j->>'scheduled_at')::timestamptz,p_id,nullif(j->>'cover_url',''),p_cycle+1, (select nullif(c.user_id,p_user) from public.ig_publisher_connections c where c.account_id=(j->>'account_id')::uuid),
 case when coalesce(f.settings->'_entrySkipAccountIds','[]'::jsonb) @> jsonb_build_array(j->>'account_id')
 and coalesce(j->>'flow_base_at',j->>'scheduled_at')::timestamptz=(select min(coalesce(first_job->>'flow_base_at',first_job->>'scheduled_at')::timestamptz) from jsonb_array_elements(p_jobs) first_job where first_job->>'account_id'=j->>'account_id')
 then 'cancelled' else 'scheduled' end,
 case when coalesce(f.settings->'_entrySkipAccountIds','[]'::jsonb) @> jsonb_build_array(j->>'account_id')
 and coalesce(j->>'flow_base_at',j->>'scheduled_at')::timestamptz=(select min(coalesce(first_job->>'flow_base_at',first_job->>'scheduled_at')::timestamptz) from jsonb_array_elements(p_jobs) first_job where first_job->>'account_id'=j->>'account_id')
 then 'flow_entry_skipped' else null end,(j->>'flow_base_at')::timestamptz
 from jsonb_array_elements(p_jobs) j;
 return true;
end; $function$;

create or replace function public.ig_campaign_progress(p_user uuid,p_id uuid)
returns table(account_id uuid,total bigint,last_at timestamptz)
language sql security invoker set search_path='' as $$
 select j.account_id,count(*) filter(where j.status='published'),
 max(case when j.status='published' then coalesce(j.flow_base_at,j.published_at) else coalesce(j.flow_base_at,j.scheduled_at) end)
 from public.ig_publication_jobs j where j.user_id=p_user and j.flow_id=p_id
 and (j.status='published' or (j.status='cancelled' and j.error_code='flow_entry_skipped'))
 group by j.account_id;
$$;

CREATE OR REPLACE FUNCTION public.ig_claim_job(p_token uuid)
 RETURNS SETOF ig_publication_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 update public.ig_publication_jobs set status='uncertain',error_code='worker_interrupted' where status='processing' and locked_at<now()-interval '10 minutes';
 return query update public.ig_publication_jobs j set status='processing',lock_token=p_token,locked_at=now(),attempts=j.attempts+1
 where j.id=(select q.id from public.ig_publication_jobs q join public.ig_publisher_connections c on c.account_id=q.account_id
 left join public.ig_flows f on f.id=q.flow_id
 where q.status='scheduled' and q.scheduled_at<=now() and q.next_attempt_at<=now() and c.user_id=q.account_owner and not c.paused and not c.reconnect_required and (q.flow_id is null or public.ig_flow_destination_ready(q.user_id,q.flow_id,q.account_id))
 and ((q.flow_id is null and q.shared_account_owner is null) or f.state='active')
 and not exists(select 1 from public.ig_publication_jobs prior where prior.account_id=q.account_id and prior.id<>q.id and prior.status='processing')
 and (q.flow_id is null or (
 not exists(select 1 from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status in ('failed','uncertain') and prior.media_urls && q.media_urls)
 and not exists(select 1 from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='scheduled' and not public.ig_flow_media_skipped(q.flow_id,q.account_id,prior.media_urls) and (coalesce(prior.flow_base_at,prior.scheduled_at),prior.id)<(coalesce(q.flow_base_at,q.scheduled_at),q.id))
 and coalesce((select max(prior.published_at) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published'),'-infinity'::timestamptz)
 + make_interval(secs => (case when coalesce((f.settings->>'gapPostDelay')::boolean,false) and coalesce(f.settings->>'schedule','gap')='gap' then 3 else (f.settings->>'gapMinutes')::double precision end)*60 + case when (select count(*) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published')>0
 and (select count(*) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published') % coalesce((f.settings->>'batchSize')::integer,500)=0 then coalesce((f.settings->>'restMinutes')::double precision,0)*60 else 0 end)<=now()))
 order by q.scheduled_at for update of q skip locked limit 1) returning j.*;
end; $function$;

commit;
