-- A flow owns its schedule and media. A guest retains ownership of each profile.
create table public.ig_flow_invites (
  flow_id uuid primary key references public.ig_flows(id) on delete cascade,
  code_hash bytea not null unique,
  expires_at timestamptz not null
);

create table public.ig_flow_shared_accounts (
  flow_id uuid not null references public.ig_flows(id) on delete cascade,
  account_id uuid not null references public.ig_publisher_connections(account_id) on delete cascade,
  account_owner uuid not null references auth.users(id) on delete cascade,
  primary key (flow_id, account_id)
);
create index ig_flow_shared_accounts_owner on public.ig_flow_shared_accounts(account_owner);
create index ig_flow_shared_accounts_account on public.ig_flow_shared_accounts(account_id);

alter table public.ig_flow_invites enable row level security;
alter table public.ig_flow_shared_accounts enable row level security;
revoke all on public.ig_flow_invites, public.ig_flow_shared_accounts from public, anon, authenticated;
grant select, insert, update, delete on public.ig_flow_invites, public.ig_flow_shared_accounts to service_role;

alter table public.ig_publication_jobs
  add column shared_account_owner uuid,
  add column account_owner uuid generated always as (coalesce(shared_account_owner, user_id)) stored;

alter table public.ig_publication_jobs
  drop constraint ig_publication_jobs_account_id_user_id_fkey,
  add constraint ig_publication_jobs_account_owner_fkey foreign key (account_id, account_owner)
    references public.instagram_accounts(id, user_id) on delete restrict;

create function public.ig_flow_destination_ready(p_user uuid, p_flow uuid, p_account uuid)
returns boolean language sql stable set search_path = '' as $$
  select public.ig_flow_account_ready(p_user,p_account) or exists (
    select 1 from public.ig_flow_shared_accounts s
    join public.ig_flows f on f.id=s.flow_id and f.user_id=p_user
    where s.flow_id=p_flow and s.account_id=p_account
      and public.avanca_account_status(s.account_owner)='approved'
      and public.ig_flow_account_ready(s.account_owner,s.account_id)
  );
$$;

create function public.ig_remove_shared_flow_account()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.ig_flows
  set settings=jsonb_set(settings,'{accountIds}',(settings->'accountIds') - old.account_id::text)
  where id=old.flow_id;

  update public.ig_publication_jobs
  set status='cancelled',error_code='flow_access_revoked'
  where flow_id=old.flow_id and account_id=old.account_id and shared_account_owner=old.account_owner
    and (status='scheduled' or (status='processing' and not publish_started));
  return old;
end;
$$;
create trigger ig_remove_shared_flow_account after delete on public.ig_flow_shared_accounts
for each row execute function public.ig_remove_shared_flow_account();

create function public.ig_begin_flow_publication(p_job uuid, p_lock uuid)
returns boolean language plpgsql set search_path = '' as $$
declare j public.ig_publication_jobs;
begin
  select * into j from public.ig_publication_jobs where id=p_job and lock_token=p_lock and status='processing';
  if not found then return false; end if;
  if j.shared_account_owner is not null then
    perform 1 from public.ig_flow_shared_accounts
    where flow_id=j.flow_id and account_id=j.account_id and account_owner=j.shared_account_owner
    for share;
    if not found or not public.ig_flow_destination_ready(j.user_id,j.flow_id,j.account_id) then
      update public.ig_publication_jobs set status='cancelled',error_code='flow_access_revoked'
      where id=p_job and lock_token=p_lock and status='processing';
      return false;
    end if;
  end if;
  update public.ig_publication_jobs set publish_started=true
  where id=p_job and lock_token=p_lock and status='processing';
  return found;
end;
$$;

CREATE OR REPLACE FUNCTION public.ig_require_live_connection()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.status not in ('scheduled','processing') then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text,0));
  if not exists(select 1 from public.ig_publisher_connections c where c.account_id=new.account_id and c.user_id=coalesce(new.shared_account_owner,new.user_id) and not c.reconnect_required) then
    raise exception 'account_not_connected';
  end if;
  if new.shared_account_owner is not null and not public.ig_flow_destination_ready(new.user_id,new.flow_id,new.account_id) then
    raise exception 'account_not_connected';
  end if;
  return new;
end; $function$;
CREATE OR REPLACE FUNCTION public.ig_guard_campaign_jobs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cfg jsonb; st text;
begin
 if new.flow_id is null then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
 select settings,state into cfg,st from public.ig_flows where id=new.flow_id and user_id=new.user_id;
 if st is distinct from 'active' then raise exception 'campaign_not_active'; end if;
 if coalesce((cfg->>'avoidReuse')::boolean,false) and exists(
 select 1 from public.ig_publication_jobs j where j.user_id=new.user_id and j.account_id=new.account_id
 and j.media_urls && new.media_urls and j.status in ('scheduled','processing','published','uncertain')
 and (j.flow_id is distinct from new.flow_id or j.flow_cycle=new.flow_cycle)) then raise exception 'media_already_used'; end if;
 return new;
end; $function$;
CREATE OR REPLACE FUNCTION public.ig_sync_flow_accounts(p_user uuid, p_id uuid, p_accounts uuid[], p_account_owner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare f public.ig_flows; combined jsonb; additions uuid[]; media_count integer; queued integer;
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
 select count(*) into media_count from (select distinct j.format,j.media_urls from public.ig_publication_jobs j where j.flow_id=p_id and j.user_id=p_user and j.status in ('scheduled','processing')) x;
 if media_count*cardinality(additions)>500 then raise exception 'flow_too_large'; end if;
 update public.ig_flows set settings=settings||jsonb_build_object('accountIds',combined) where id=p_id;
 insert into public.ig_publication_jobs(id,user_id,account_id,caption,format,media_urls,scheduled_at,next_attempt_at,flow_id,cover_url,flow_cycle,shared_account_owner)
 select gen_random_uuid(),p_user,account.id,j.caption,j.format,j.media_urls,j.scheduled_at,now(),p_id,j.cover_url,f.cycle,nullif(p_account_owner,p_user)
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
 update public.ig_flows set cycle=cycle+1,last_error=null where id=p_id;
 insert into public.ig_publication_jobs(id,user_id,account_id,caption,format,media_urls,scheduled_at,flow_id,cover_url,flow_cycle,shared_account_owner)
 select (j->>'id')::uuid,p_user,(j->>'account_id')::uuid,j->>'caption',j->>'format',array(select jsonb_array_elements_text(j->'media_urls')),(j->>'scheduled_at')::timestamptz,p_id,nullif(j->>'cover_url',''),p_cycle+1, (select nullif(c.user_id,p_user) from public.ig_publisher_connections c where c.account_id=(j->>'account_id')::uuid) from jsonb_array_elements(p_jobs) j;
 return true;
end; $function$;
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
 and not exists(select 1 from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='scheduled' and not public.ig_flow_media_skipped(q.flow_id,q.account_id,prior.media_urls) and (prior.scheduled_at,prior.id)<(q.scheduled_at,q.id))
 and coalesce((select max(prior.published_at) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published'),'-infinity'::timestamptz)
 + make_interval(secs => (f.settings->>'gapMinutes')::double precision*60 + case when (select count(*) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published')>0
 and (select count(*) from public.ig_publication_jobs prior where prior.flow_id=q.flow_id and prior.account_id=q.account_id and prior.status='published') % coalesce((f.settings->>'batchSize')::integer,500)=0 then coalesce((f.settings->>'restMinutes')::double precision,0)*60 else 0 end)<=now()))
 order by q.scheduled_at for update of q skip locked limit 1) returning j.*;
end; $function$;
CREATE OR REPLACE FUNCTION public.ig_flow_runtime(p_user uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
 'available',coalesce((select jsonb_agg(ids.id) from jsonb_array_elements_text(f.settings->'accountIds') ids(id)
 where public.ig_flow_destination_ready(p_user,f.id,ids.id::uuid)),'[]'::jsonb),
 'excluded',coalesce((select jsonb_agg(x) from (select distinct j.account_id,u.url from public.ig_publication_jobs j
 cross join lateral unnest(j.media_urls) u(url) where j.flow_id=f.id and j.user_id=p_user and j.status in ('failed','uncertain')) x),'[]'::jsonb))
 from public.ig_flows f where f.id=p_id and f.user_id=p_user;
$function$;
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
 -- Preserve attempts for audit, but remove unusable future items from the runnable queue.
 update public.ig_publication_jobs q set status='cancelled',error_code=case
 when not public.ig_flow_destination_ready(q.user_id,q.flow_id,q.account_id) then 'account_unavailable' else 'media_skipped_after_error' end
 from public.ig_flows f where q.flow_id=f.id and f.state='active' and q.status='scheduled'
 and (not public.ig_flow_destination_ready(q.user_id,q.flow_id,q.account_id) or public.ig_flow_media_skipped(f.id,q.account_id,q.media_urls));
 update public.ig_flows f set state='completed',last_error=null where state='active' and coalesce(settings->>'repeat','once')='once'
 and not exists(select 1 from public.ig_publication_jobs j where j.flow_id=f.id and j.status in ('scheduled','processing'));
 update public.ig_flows f set state='paused',last_error='no_available_accounts' where state='active' and settings->>'repeat'='loop'
 and not exists(select 1 from jsonb_array_elements_text(f.settings->'accountIds') ids(id) where public.ig_flow_destination_ready(f.user_id,f.id,ids.id::uuid));
 return query select f.* from public.ig_flows f where state='active' and settings->>'repeat'='loop'
 and not exists(select 1 from public.ig_publication_jobs j where j.flow_id=f.id and j.status in ('scheduled','processing'))
 order by f.created_at limit 10;
end; $function$;
create or replace function public.ig_add_flow_accounts(p_user uuid, p_id uuid, p_accounts uuid[])
returns jsonb language sql set search_path = '' as $$
  select public.ig_sync_flow_accounts(p_user,p_id,p_accounts,p_user);
$$;

create function public.ig_create_flow_invite(p_user uuid, p_flow uuid)
returns text language plpgsql set search_path = '' as $$
declare code text := replace(gen_random_uuid()::text,'-','');
begin
  perform 1 from public.ig_flows where id=p_flow and user_id=p_user and state='active' for update;
  if not found then raise exception 'campaign_not_active'; end if;
  insert into public.ig_flow_invites(flow_id,code_hash,expires_at)
  values(p_flow,sha256(convert_to(code,'UTF8')),now()+interval '24 hours')
  on conflict(flow_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at;
  return code;
end;
$$;

create function public.ig_preview_flow_invite(p_user uuid, p_code text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'name',f.name,
    'accounts',coalesce((
      select jsonb_agg(jsonb_build_object('id',a.id,'username',a.username) order by a.username,a.id)
      from public.instagram_accounts a
      where a.user_id=p_user and public.ig_flow_account_ready(p_user,a.id)
        and not (f.settings->'accountIds' ? a.id::text)
    ),'[]'::jsonb)
  ) into result
  from public.ig_flow_invites i join public.ig_flows f on f.id=i.flow_id
  where i.code_hash=sha256(convert_to(p_code,'UTF8')) and i.expires_at>now()
    and f.state='active' and f.user_id<>p_user;
  if result is null then raise exception 'invalid_flow_invite'; end if;
  return result;
end;
$$;

create function public.ig_accept_flow_invite(p_user uuid, p_code text, p_accounts uuid[])
returns jsonb language plpgsql set search_path = '' as $$
declare f public.ig_flows; invite_hash bytea := sha256(convert_to(p_code,'UTF8'));
begin
  select f0.* into f from public.ig_flow_invites i join public.ig_flows f0 on f0.id=i.flow_id
  where i.code_hash=invite_hash and i.expires_at>now() and f0.user_id<>p_user;
  if not found then raise exception 'invalid_flow_invite'; end if;
  perform pg_advisory_xact_lock(hashtextextended(f.user_id::text,0));
  perform 1 from public.ig_flows where id=f.id and user_id=f.user_id and state='active' for update;
  if not found or not exists(select 1 from public.ig_flow_invites where flow_id=f.id and code_hash=invite_hash and expires_at>now()) then
    raise exception 'invalid_flow_invite';
  end if;
  if p_accounts is null or cardinality(p_accounts) not between 1 and 50 or array_position(p_accounts,null) is not null then
    raise exception 'invalid_accounts';
  end if;
  if exists(select 1 from unnest(p_accounts) a(id) where not public.ig_flow_account_ready(p_user,a.id)) then
    raise exception 'account_not_connected';
  end if;
  insert into public.ig_flow_shared_accounts(flow_id,account_id,account_owner)
  select f.id,a.id,p_user from unnest(p_accounts) a(id) on conflict do nothing;
  return public.ig_sync_flow_accounts(f.user_id,f.id,p_accounts,p_user);
end;
$$;

create function public.ig_list_shared_flow_accounts(p_user uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'flow_id',f.id,'flow_name',f.name,'account_id',a.id,'username',a.username
  ) order by f.name,a.username),'[]'::jsonb)
  from public.ig_flow_shared_accounts s
  join public.ig_flows f on f.id=s.flow_id
  join public.instagram_accounts a on a.id=s.account_id and a.user_id=s.account_owner
  where s.account_owner=p_user;
$$;

create function public.ig_revoke_shared_flow_account(p_user uuid, p_flow uuid, p_account uuid)
returns void language plpgsql set search_path = '' as $$
begin
  perform 1 from public.ig_flows f
  where f.id=p_flow and exists(select 1 from public.ig_flow_shared_accounts s
    where s.flow_id=f.id and s.account_id=p_account and s.account_owner=p_user)
  for update;
  if not found then return; end if;
  delete from public.ig_flow_shared_accounts
  where flow_id=p_flow and account_id=p_account and account_owner=p_user;
end;
$$;

revoke execute on function public.ig_flow_destination_ready(uuid,uuid,uuid),
  public.ig_remove_shared_flow_account(), public.ig_begin_flow_publication(uuid,uuid),
  public.ig_sync_flow_accounts(uuid,uuid,uuid[],uuid), public.ig_create_flow_invite(uuid,uuid),
  public.ig_preview_flow_invite(uuid,text), public.ig_accept_flow_invite(uuid,text,uuid[]),
  public.ig_list_shared_flow_accounts(uuid), public.ig_revoke_shared_flow_account(uuid,uuid,uuid)
from public, anon, authenticated;
grant execute on function public.ig_flow_destination_ready(uuid,uuid,uuid),
  public.ig_remove_shared_flow_account(), public.ig_begin_flow_publication(uuid,uuid),
  public.ig_sync_flow_accounts(uuid,uuid,uuid[],uuid), public.ig_create_flow_invite(uuid,uuid),
  public.ig_preview_flow_invite(uuid,text), public.ig_accept_flow_invite(uuid,text,uuid[]),
  public.ig_list_shared_flow_accounts(uuid), public.ig_revoke_shared_flow_account(uuid,uuid,uuid)
to service_role;

CREATE OR REPLACE FUNCTION public.ig_disconnect_account(p_user uuid, p_account uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_graph text; v_secret uuid; flow record; remaining jsonb;
begin
  if p_user is null or p_account is null or not exists(select 1 from public.instagram_accounts where id=p_account and user_id=p_user) then
    raise exception 'account_not_found';
  end if;
  select graph_id,secret_id into v_graph,v_secret from public.ig_publisher_connections where account_id=p_account and user_id=p_user;
  if not found then return; end if;
  -- Same graph/owner lock order as OAuth connection, flow creation and scheduling.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_graph,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text,0));
  select graph_id,secret_id into v_graph,v_secret from public.ig_publisher_connections where account_id=p_account and user_id=p_user for update;
  if not found then return; end if;
  perform 1 from public.ig_publication_jobs where account_id=p_account and account_owner=p_user and status in ('scheduled','processing') order by id for update;
  if exists(select 1 from public.ig_publication_jobs where account_id=p_account and account_owner=p_user and status='processing') then
    raise exception 'account_busy';
  end if;
  update public.ig_publication_jobs set status='cancelled',error_code='account_disconnected' where account_id=p_account and account_owner=p_user and status='scheduled';
  for flow in select id,settings from public.ig_flows where user_id=p_user and settings->'accountIds' ? p_account::text order by id for update loop
    select coalesce(jsonb_agg(value),'[]'::jsonb) into remaining from jsonb_array_elements_text(flow.settings->'accountIds') as ids(value) where value<>p_account::text;
    update public.ig_flows set settings=jsonb_set(flow.settings,'{accountIds}',remaining),state=case when jsonb_array_length(remaining)=0 then 'stopped' else state end where id=flow.id and user_id=p_user;
  end loop;
  insert into public.ig_disconnected_accounts(account_id,user_id,graph_id) values(p_account,p_user,v_graph)
  on conflict(account_id) do update set removed_at=now();
  delete from public.ig_publisher_connections where account_id=p_account and user_id=p_user;
  delete from vault.secrets s where s.id=v_secret and not exists(select 1 from public.ig_publisher_connections c where c.secret_id=s.id);
end; $function$;