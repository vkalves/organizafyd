begin;
-- These helpers are private service-role operations; the existing user RLS remains unchanged.
create or replace function public.ig_flow_account_ready(p_user uuid,p_account uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.ig_publisher_connections c where c.account_id=p_account and c.user_id=p_user
 and not c.paused and not c.reconnect_required and (c.token_expires_at is null or c.token_expires_at>now())
 and not exists(select 1 from public.ig_account_health h where h.account_id=c.account_id and h.user_id=p_user and h.state in ('reconnect','permissions','unavailable')));
$$;
create or replace function public.ig_flow_media_skipped(p_flow uuid,p_account uuid,p_urls text[])
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.ig_publication_jobs j where j.flow_id=p_flow and j.account_id=p_account
 and j.status in ('failed','uncertain') and j.media_urls && p_urls);
$$;
create or replace function public.ig_flow_runtime(p_user uuid,p_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'available',coalesce((select jsonb_agg(ids.id) from jsonb_array_elements_text(f.settings->'accountIds') ids(id)
 where public.ig_flow_account_ready(p_user,ids.id::uuid)),'[]'::jsonb),
 'excluded',coalesce((select jsonb_agg(x) from (select distinct j.account_id,u.url from public.ig_publication_jobs j
 cross join lateral unnest(j.media_urls) u(url) where j.flow_id=f.id and j.user_id=p_user and j.status in ('failed','uncertain')) x),'[]'::jsonb))
 from public.ig_flows f where f.id=p_id and f.user_id=p_user;
$$;
create or replace function public.ig_campaign_due() returns setof public.ig_flows language plpgsql security invoker set search_path='' as $$
begin
 -- Resume only pauses caused by the old blanket failure rule, never a manual pause.
 update public.ig_flows f set state='active',last_error=null where state='paused' and last_error in ('publication_needs_review','no_available_accounts')
 and (exists(select 1 from public.ig_publication_jobs q where q.flow_id=f.id and q.status='scheduled'
 and public.ig_flow_account_ready(f.user_id,q.account_id) and not public.ig_flow_media_skipped(f.id,q.account_id,q.media_urls))
 or (f.settings->>'repeat'='loop' and exists(select 1 from jsonb_array_elements_text(f.settings->'accountIds') ids(id)
 where public.ig_flow_account_ready(f.user_id,ids.id::uuid))));
 -- Preserve attempts for audit, but remove unusable future items from the runnable queue.
 update public.ig_publication_jobs q set status='cancelled',error_code=case
 when not public.ig_flow_account_ready(q.user_id,q.account_id) then 'account_unavailable' else 'media_skipped_after_error' end
 from public.ig_flows f where q.flow_id=f.id and f.state='active' and q.status='scheduled'
 and (not public.ig_flow_account_ready(q.user_id,q.account_id) or public.ig_flow_media_skipped(f.id,q.account_id,q.media_urls));
 update public.ig_flows f set state='completed',last_error=null where state='active' and coalesce(settings->>'repeat','once')='once'
 and not exists(select 1 from public.ig_publication_jobs j where j.flow_id=f.id and j.status in ('scheduled','processing'));
 update public.ig_flows f set state='paused',last_error='no_available_accounts' where state='active' and settings->>'repeat'='loop'
 and not exists(select 1 from jsonb_array_elements_text(f.settings->'accountIds') ids(id) where public.ig_flow_account_ready(f.user_id,ids.id::uuid));
 return query select f.* from public.ig_flows f where state='active' and settings->>'repeat'='loop'
 and not exists(select 1 from public.ig_publication_jobs j where j.flow_id=f.id and j.status in ('scheduled','processing'))
 order by f.created_at limit 10;
end; $$;
create or replace function public.ig_append_flow_cycle(p_user uuid,p_id uuid,p_cycle integer,p_jobs jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare f public.ig_flows;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into f from public.ig_flows where id=p_id and user_id=p_user for update;
 if not found or f.state<>'active' or f.cycle<>p_cycle or coalesce(f.settings->>'repeat','once')<>'loop' then return false; end if;
 if exists(select 1 from public.ig_publication_jobs where flow_id=p_id and status in ('scheduled','processing')) then return false; end if;
 if jsonb_array_length(p_jobs) not between 1 and 500 then raise exception 'invalid_media'; end if;
 if exists(select 1 from jsonb_array_elements(p_jobs) j left join public.ig_publisher_connections c on c.account_id=(j->>'account_id')::uuid and c.user_id=p_user where c.account_id is null or not public.ig_flow_account_ready(p_user,c.account_id) or not (f.settings->'accountIds' @> jsonb_build_array(c.account_id::text)) or public.ig_flow_media_skipped(p_id,c.account_id,array(select jsonb_array_elements_text(j->'media_urls')))) then return false; end if;
 if exists(select 1 from jsonb_array_elements(p_jobs) j where not exists(select 1 from public.ig_flow_library m where m.user_id=p_user and not m.retired and m.id::text in (select jsonb_array_elements_text(f.settings->'mediaIds')) and m.url=j->'media_urls'->>0)) then raise exception 'invalid_media_owner'; end if;
 update public.ig_flows set cycle=cycle+1,last_error=null where id=p_id;
 insert into public.ig_publication_jobs(id,user_id,account_id,caption,format,media_urls,scheduled_at,flow_id,cover_url,flow_cycle)
 select (j->>'id')::uuid,p_user,(j->>'account_id')::uuid,j->>'caption',j->>'format',array(select jsonb_array_elements_text(j->'media_urls')),(j->>'scheduled_at')::timestamptz,p_id,nullif(j->>'cover_url',''),p_cycle+1 from jsonb_array_elements(p_jobs) j;
 return true;
end; $$;

create or replace function public.ig_control_flow(p_user uuid,p_id uuid,p_action text) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 if p_action not in ('pause','resume','stop') then raise exception 'invalid_campaign'; end if;
 if not exists(select 1 from public.ig_flows where id=p_id and user_id=p_user) then raise exception 'invalid_flow'; end if;
 if p_action in ('pause','resume') and exists(select 1 from public.ig_flows where id=p_id and state in ('stopped','completed')) then raise exception 'campaign_stopped'; end if;
 update public.ig_flows set state=case p_action when 'pause' then 'paused' when 'resume' then 'active' else 'stopped' end,last_error=null where id=p_id and user_id=p_user;
 if p_action='stop' then update public.ig_publication_jobs set status='cancelled' where user_id=p_user and flow_id=p_id and status='scheduled'; end if;
end; $$;
create or replace function public.ig_claim_job(p_token uuid) returns setof public.ig_publication_jobs language plpgsql security definer set search_path='' as $$
begin
 update public.ig_publication_jobs set status='uncertain',error_code='worker_interrupted' where status='processing' and locked_at<now()-interval '10 minutes';
 return query update public.ig_publication_jobs j set status='processing',lock_token=p_token,locked_at=now(),attempts=j.attempts+1
 where j.id=(select q.id from public.ig_publication_jobs q join public.ig_publisher_connections c on c.account_id=q.account_id
 left join public.ig_flows f on f.id=q.flow_id
 where q.status='scheduled' and q.scheduled_at<=now() and q.next_attempt_at<=now() and c.user_id=q.user_id and not c.paused and not c.reconnect_required and (q.flow_id is null or public.ig_flow_account_ready(q.user_id,q.account_id))
 and (q.flow_id is null or f.state='active')
 and not exists(select 1 from public.ig_publication_jobs prior where prior.account_id=q.account_id and prior.id<>q.id and prior.status='processing')
 and (q.flow_id is null or (
 not exists(select 1 from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status in ('failed','uncertain') and prior.media_urls && q.media_urls)
 and not exists(select 1 from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='scheduled' and not public.ig_flow_media_skipped(q.flow_id,q.account_id,prior.media_urls) and (prior.scheduled_at,prior.id)<(q.scheduled_at,q.id))
 and coalesce((select max(prior.published_at) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published'),'-infinity'::timestamptz)
 + make_interval(secs => (f.settings->>'gapMinutes')::double precision*60 + case when (select count(*) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published')>0
 and (select count(*) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published') % coalesce((f.settings->>'batchSize')::integer,500)=0 then coalesce((f.settings->>'restMinutes')::double precision,0)*60 else 0 end)<=now()))
 order by q.scheduled_at for update of q skip locked limit 1) returning j.*;
end; $$;


revoke all on function public.ig_flow_account_ready(uuid,uuid),public.ig_flow_media_skipped(uuid,uuid,text[]),public.ig_flow_runtime(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ig_flow_account_ready(uuid,uuid),public.ig_flow_media_skipped(uuid,uuid,text[]),public.ig_flow_runtime(uuid,uuid) to service_role;
revoke all on function public.ig_campaign_due(),public.ig_append_flow_cycle(uuid,uuid,integer,jsonb),public.ig_control_flow(uuid,uuid,text),public.ig_claim_job(uuid) from public,anon,authenticated;
grant execute on function public.ig_campaign_due(),public.ig_append_flow_cycle(uuid,uuid,integer,jsonb),public.ig_control_flow(uuid,uuid,text),public.ig_claim_job(uuid) to service_role;
commit;
