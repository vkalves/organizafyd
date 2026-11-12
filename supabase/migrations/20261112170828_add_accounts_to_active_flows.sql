begin;
-- Atomically extend an active campaign and copy its remaining media to new accounts.
-- A repeated sync is a no-op. Existing jobs and completed publications are untouched.
create or replace function public.ig_add_flow_accounts(p_user uuid,p_id uuid,p_accounts uuid[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f public.ig_flows; combined jsonb; additions uuid[]; media_count integer; queued integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into f from public.ig_flows where id=p_id and user_id=p_user for update;
 if not found then raise exception 'invalid_flow'; end if;
 if f.state<>'active' then raise exception 'campaign_not_active'; end if;
 if p_accounts is null or cardinality(p_accounts) not between 1 and 50 or array_position(p_accounts,null) is not null then raise exception 'invalid_accounts'; end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into additions from (select distinct id from unnest(p_accounts) ids(id) where not(f.settings->'accountIds' @> jsonb_build_array(id::text))) x;
 if cardinality(additions)=0 then return jsonb_build_object('added',0,'queued',0); end if;
 if exists(select 1 from unnest(additions) ids(id) where not public.ig_flow_account_ready(p_user,ids.id)) then raise exception 'account_not_connected'; end if;
 combined:=(f.settings->'accountIds')||to_jsonb(additions);
 if jsonb_array_length(combined)>50 then raise exception 'invalid_accounts'; end if;
 if coalesce(f.settings->>'distribution','all')='all' and jsonb_array_length(combined)*jsonb_array_length(f.settings->'mediaIds')>500 then raise exception 'flow_too_large'; end if;
 select count(*) into media_count from (select distinct j.format,j.media_urls from public.ig_publication_jobs j where j.flow_id=p_id and j.user_id=p_user and j.status in ('scheduled','processing')) x;
 if media_count*cardinality(additions)>500 then raise exception 'flow_too_large'; end if;
 update public.ig_flows set settings=settings||jsonb_build_object('accountIds',combined) where id=p_id;
 insert into public.ig_publication_jobs(id,user_id,account_id,caption,format,media_urls,scheduled_at,next_attempt_at,flow_id,cover_url,flow_cycle)
 select gen_random_uuid(),p_user,account.id,j.caption,j.format,j.media_urls,j.scheduled_at,now(),p_id,j.cover_url,f.cycle
 from unnest(additions) account(id)
 cross join (select distinct on (format,media_urls) caption,format,media_urls,scheduled_at,cover_url from public.ig_publication_jobs
 where flow_id=p_id and user_id=p_user and status in ('scheduled','processing') order by format,media_urls,scheduled_at,id) j
 where not public.ig_flow_media_skipped(p_id,account.id,j.media_urls)
 and (not coalesce((f.settings->>'avoidReuse')::boolean,false) or not exists(
 select 1 from public.ig_publication_jobs prior where prior.user_id=p_user and prior.account_id=account.id
 and prior.media_urls && j.media_urls and prior.status in ('scheduled','processing','published','uncertain')
 and (prior.flow_id is distinct from p_id or prior.flow_cycle=f.cycle)));
 get diagnostics queued = row_count;
 return jsonb_build_object('added',cardinality(additions),'queued',queued);
end; $$;
revoke all on function public.ig_add_flow_accounts(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.ig_add_flow_accounts(uuid,uuid,uuid[]) to service_role;
commit;
