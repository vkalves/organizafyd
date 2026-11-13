begin;
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
 if coalesce(f.settings->>'schedule','gap')='slots' then
   first_at:=date_trunc('minute',first_at);
 end if;
 -- Random media order differs between accounts. Copy one item per time slot,
 -- rather than the union of all accounts' media for that slot.
 with media_templates as (
 select distinct on (format,media_urls) caption,format,media_urls,coalesce(flow_base_at,scheduled_at) as base_at,cover_url
 from public.ig_publication_jobs where flow_id=p_id and user_id=p_user and status='scheduled'
 order by format,media_urls,coalesce(flow_base_at,scheduled_at),id
 ), slotted as (
 select *, case when coalesce(f.settings->>'schedule','gap')='slots'
   then date_trunc('minute',base_at)
   else date_bin(make_interval(secs=>greatest(3,(f.settings->>'gapMinutes')::double precision)*60),base_at,first_at)
 end as slot_at from media_templates
 ), templates as (
 select distinct on (slot_at,case when f.settings->>'distribution'='split' then media_urls else '{}'::text[] end)
 caption,format,media_urls,slot_at as base_at,cover_url
 from slotted order by slot_at,case when f.settings->>'distribution'='split' then media_urls else '{}'::text[] end,base_at,format,media_urls
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


commit;
