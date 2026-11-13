begin;
-- New accounts skip the next flow slot once. Existing accounts are untouched.
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
 select min(scheduled_at) into first_at from public.ig_publication_jobs
 where flow_id=p_id and user_id=p_user and status='scheduled';
 update public.ig_flows set settings=settings||jsonb_build_object('accountIds',combined,
 '_entrySkipAccountIds',coalesce(settings->'_entrySkipAccountIds','[]'::jsonb)||case when first_at is null then to_jsonb(additions) else '[]'::jsonb end) where id=p_id;
 insert into public.ig_publication_jobs(id,user_id,account_id,caption,format,media_urls,scheduled_at,next_attempt_at,flow_id,cover_url,flow_cycle,shared_account_owner,status,error_code)
 select gen_random_uuid(),p_user,account.id,j.caption,j.format,j.media_urls,j.scheduled_at,now(),p_id,j.cover_url,f.cycle,nullif(p_account_owner,p_user),
 case when j.scheduled_at=first_at then 'cancelled' else 'scheduled' end,
 case when j.scheduled_at=first_at then 'flow_entry_skipped' else null end
 from unnest(additions) account(id)
 cross join (select distinct on (format,media_urls) caption,format,media_urls,scheduled_at,cover_url from public.ig_publication_jobs
 where flow_id=p_id and user_id=p_user and status='scheduled' order by format,media_urls,scheduled_at,id) j
 where not public.ig_flow_media_skipped(p_id,account.id,j.media_urls)
 and (not coalesce((f.settings->>'avoidReuse')::boolean,false) or not exists(
 select 1 from public.ig_publication_jobs prior where prior.user_id=p_user and prior.account_id=account.id
 and prior.media_urls && j.media_urls and prior.status in ('scheduled','processing','published','uncertain')
 and (prior.flow_id is distinct from p_id or prior.flow_cycle=f.cycle)));
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
 insert into public.ig_publication_jobs(id,user_id,account_id,caption,format,media_urls,scheduled_at,flow_id,cover_url,flow_cycle,shared_account_owner,status,error_code)
 select (j->>'id')::uuid,p_user,(j->>'account_id')::uuid,j->>'caption',j->>'format',array(select jsonb_array_elements_text(j->'media_urls')),(j->>'scheduled_at')::timestamptz,p_id,nullif(j->>'cover_url',''),p_cycle+1, (select nullif(c.user_id,p_user) from public.ig_publisher_connections c where c.account_id=(j->>'account_id')::uuid),
 case when coalesce(f.settings->'_entrySkipAccountIds','[]'::jsonb) @> jsonb_build_array(j->>'account_id')
 and (j->>'scheduled_at')::timestamptz=(select min((first_job->>'scheduled_at')::timestamptz) from jsonb_array_elements(p_jobs) first_job where first_job->>'account_id'=j->>'account_id')
 then 'cancelled' else 'scheduled' end,
 case when coalesce(f.settings->'_entrySkipAccountIds','[]'::jsonb) @> jsonb_build_array(j->>'account_id')
 and (j->>'scheduled_at')::timestamptz=(select min((first_job->>'scheduled_at')::timestamptz) from jsonb_array_elements(p_jobs) first_job where first_job->>'account_id'=j->>'account_id')
 then 'flow_entry_skipped' else null end
 from jsonb_array_elements(p_jobs) j;
 return true;
end; $function$;

-- A skipped slot is not a publication, but preserves the schedule anchor when
-- a loop has only one media item and advances again after the skip.
create or replace function public.ig_campaign_progress(p_user uuid,p_id uuid)
returns table(account_id uuid,total bigint,last_at timestamptz)
language sql security invoker set search_path='' as $$
 select j.account_id,count(*) filter(where j.status='published'),
 max(case when j.status='published' then j.published_at else j.scheduled_at end)
 from public.ig_publication_jobs j where j.user_id=p_user and j.flow_id=p_id
 and (j.status='published' or (j.status='cancelled' and j.error_code='flow_entry_skipped'))
 group by j.account_id;
$$;

commit;
