begin;
alter table public.ig_flows add column state text not null default 'active' check(state in ('active','paused','stopped','completed')),
 add column cycle integer not null default 1 check(cycle>0), add column last_error text;
alter table public.ig_publication_jobs add column flow_cycle integer not null default 1 check(flow_cycle>0);
alter table public.ig_flow_preferences add column folder_captions jsonb not null default '{}';
create index ig_jobs_campaign_cycle on public.ig_publication_jobs(flow_id,flow_cycle,status);
-- Reusable libraries must never be automatically deleted after a completed cycle.
update public.ig_flow_library set retired=false where retired;
create or replace function public.ig_retire_flow_media() returns void language plpgsql security invoker set search_path='' as $$ begin return; end; $$;

create function public.ig_flow_used(p_user uuid,p_urls text[])
returns table(account_id uuid,url text,flow_id uuid) language sql security invoker set search_path='' as $$
 select distinct j.account_id,u.url,j.flow_id from public.ig_publication_jobs j cross join lateral unnest(j.media_urls) u(url)
 where j.user_id=p_user and u.url=any(p_urls) and j.status in ('scheduled','processing','published','uncertain');
$$;

create function public.ig_guard_campaign_jobs() returns trigger language plpgsql security invoker set search_path='' as $$
declare cfg jsonb; st text;
begin
 if new.flow_id is null then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
 select settings,state into cfg,st from public.ig_flows where id=new.flow_id and user_id=new.user_id;
 if st<>'active' then raise exception 'campaign_not_active'; end if;
 if coalesce((cfg->>'avoidReuse')::boolean,false) and exists(
 select 1 from public.ig_publication_jobs j where j.user_id=new.user_id and j.account_id=new.account_id
 and j.media_urls && new.media_urls and j.status in ('scheduled','processing','published','uncertain')
 and (j.flow_id is distinct from new.flow_id or j.flow_cycle=new.flow_cycle)) then raise exception 'media_already_used'; end if;
 return new;
end; $$;
create trigger ig_guard_campaign_jobs before insert on public.ig_publication_jobs for each row execute function public.ig_guard_campaign_jobs();

create function public.ig_campaign_due() returns setof public.ig_flows language plpgsql security invoker set search_path='' as $$
begin
 update public.ig_flows f set state='paused',last_error='publication_needs_review' where state='active' and exists(select 1 from public.ig_publication_jobs j where j.flow_id=f.id and j.flow_cycle=f.cycle and j.status in ('failed','uncertain'));
 update public.ig_flows f set state='completed' where state='active' and coalesce(settings->>'repeat','once')='once'
 and not exists(select 1 from public.ig_publication_jobs j where j.flow_id=f.id and j.status not in ('published','cancelled'));
 return query select f.* from public.ig_flows f where state='active' and settings->>'repeat'='loop'
 and not exists(select 1 from public.ig_publication_jobs j where j.flow_id=f.id and j.status not in ('published','cancelled'))
 and exists(select 1 from public.ig_publication_jobs j where j.flow_id=f.id and j.flow_cycle=f.cycle and j.status='published')
 and not exists(select 1 from jsonb_array_elements_text(f.settings->'accountIds') ids(id) left join public.ig_publisher_connections c on c.account_id=ids.id::uuid and c.user_id=f.user_id where c.account_id is null or c.paused or c.reconnect_required)
 order by f.created_at limit 10;
end; $$;

create function public.ig_append_flow_cycle(p_user uuid,p_id uuid,p_cycle integer,p_jobs jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare f public.ig_flows;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into f from public.ig_flows where id=p_id and user_id=p_user for update;
 if not found or f.state<>'active' or f.cycle<>p_cycle or coalesce(f.settings->>'repeat','once')<>'loop' then return false; end if;
 if exists(select 1 from public.ig_publication_jobs where flow_id=p_id and status not in ('published','cancelled')) then return false; end if;
 if jsonb_array_length(p_jobs) not between 1 and 500 then raise exception 'invalid_media'; end if;
 if exists(select 1 from jsonb_array_elements(p_jobs) j left join public.ig_publisher_connections c on c.account_id=(j->>'account_id')::uuid and c.user_id=p_user where c.account_id is null or c.paused or c.reconnect_required) then return false; end if;
 if exists(select 1 from jsonb_array_elements(p_jobs) j where not exists(select 1 from public.ig_flow_library m where m.user_id=p_user and not m.retired and m.id::text in (select jsonb_array_elements_text(f.settings->'mediaIds')) and m.url=j->'media_urls'->>0)) then raise exception 'invalid_media_owner'; end if;
 update public.ig_flows set cycle=cycle+1,last_error=null where id=p_id;
 insert into public.ig_publication_jobs(id,user_id,account_id,caption,format,media_urls,scheduled_at,flow_id,cover_url,flow_cycle)
 select (j->>'id')::uuid,p_user,(j->>'account_id')::uuid,j->>'caption',j->>'format',array(select jsonb_array_elements_text(j->'media_urls')),(j->>'scheduled_at')::timestamptz,p_id,nullif(j->>'cover_url',''),p_cycle+1 from jsonb_array_elements(p_jobs) j;
 return true;
end; $$;

create function public.ig_control_flow(p_user uuid,p_id uuid,p_action text) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 if p_action not in ('pause','resume','stop') then raise exception 'invalid_campaign'; end if;
 if not exists(select 1 from public.ig_flows where id=p_id and user_id=p_user) then raise exception 'invalid_flow'; end if;
 if p_action in ('pause','resume') and exists(select 1 from public.ig_flows where id=p_id and state in ('stopped','completed')) then raise exception 'campaign_stopped'; end if;
 if p_action='resume' and exists(select 1 from public.ig_publication_jobs where flow_id=p_id and status in ('failed','uncertain')) then raise exception 'publication_needs_review'; end if;
 update public.ig_flows set state=case p_action when 'pause' then 'paused' when 'resume' then 'active' else 'stopped' end,last_error=null where id=p_id and user_id=p_user;
 if p_action='stop' then update public.ig_publication_jobs set status='cancelled' where user_id=p_user and flow_id=p_id and status='scheduled'; end if;
end; $$;

-- Keep the original claim semantics, adding campaign state and real completion-based pacing.
create or replace function public.ig_claim_job(p_token uuid) returns setof public.ig_publication_jobs language plpgsql security definer set search_path='' as $$
begin
 update public.ig_publication_jobs set status='uncertain',error_code='worker_interrupted' where status='processing' and locked_at<now()-interval '10 minutes';
 return query update public.ig_publication_jobs j set status='processing',lock_token=p_token,locked_at=now(),attempts=j.attempts+1
 where j.id=(select q.id from public.ig_publication_jobs q join public.ig_publisher_connections c on c.account_id=q.account_id
 left join public.ig_flows f on f.id=q.flow_id
 where q.status='scheduled' and q.scheduled_at<=now() and q.next_attempt_at<=now() and not c.paused and not c.reconnect_required
 and (q.flow_id is null or f.state='active')
 and not exists(select 1 from public.ig_publication_jobs prior where prior.account_id=q.account_id and prior.id<>q.id and prior.status='processing')
 and (q.flow_id is null or (
 not exists(select 1 from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status in ('failed','uncertain'))
 and not exists(select 1 from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='scheduled' and (prior.scheduled_at,prior.id)<(q.scheduled_at,q.id))
 and coalesce((select max(prior.published_at) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published'),'-infinity'::timestamptz)
 + make_interval(secs => (f.settings->>'gapMinutes')::double precision*60 + case when (select count(*) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published')>0
 and (select count(*) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published') % coalesce((f.settings->>'batchSize')::integer,500)=0 then coalesce((f.settings->>'restMinutes')::double precision,0)*60 else 0 end)<=now()))
 order by q.scheduled_at for update of q skip locked limit 1) returning j.*;
end; $$;

create function public.ig_campaign_report(p_user uuid) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('flows',coalesce((select jsonb_agg(x) from (select f.id, count(j.id) filter(where j.status='published') as published,count(j.id) filter(where j.status in ('scheduled','processing')) as pending,count(j.id) filter(where j.status in ('failed','uncertain')) as review from public.ig_flows f left join public.ig_publication_jobs j on j.flow_id=f.id where f.user_id=p_user group by f.id) x),'[]'::jsonb),
 'usage',coalesce((select jsonb_agg(x) from (select j.account_id,m.id as media_id,count(*) filter(where j.status='published') as published,count(*) filter(where j.status in ('scheduled','processing','uncertain')) as pending,max(j.published_at) as last_published_at from public.ig_flow_library m join public.ig_publication_jobs j on m.url=any(j.media_urls) and j.user_id=m.user_id where m.user_id=p_user group by j.account_id,m.id) x),'[]'::jsonb));
$$;
create function public.ig_campaign_progress(p_user uuid,p_id uuid) returns table(account_id uuid,total bigint,last_at timestamptz) language sql security invoker set search_path='' as $$
 select j.account_id,count(*),max(j.published_at) from public.ig_publication_jobs j where j.user_id=p_user and j.flow_id=p_id and j.status='published' group by j.account_id;
$$;
revoke all on function public.ig_campaign_progress(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ig_campaign_progress(uuid,uuid) to service_role;
revoke all on function public.ig_flow_used(uuid,text[]),public.ig_campaign_due(),public.ig_append_flow_cycle(uuid,uuid,integer,jsonb),public.ig_control_flow(uuid,uuid,text),public.ig_campaign_report(uuid),public.ig_guard_campaign_jobs(),public.ig_claim_job(uuid) from public,anon,authenticated;
grant execute on function public.ig_flow_used(uuid,text[]),public.ig_campaign_due(),public.ig_append_flow_cycle(uuid,uuid,integer,jsonb),public.ig_control_flow(uuid,uuid,text),public.ig_campaign_report(uuid),public.ig_guard_campaign_jobs(),public.ig_claim_job(uuid) to service_role;
commit;
