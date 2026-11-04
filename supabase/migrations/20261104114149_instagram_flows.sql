begin;
create table public.ig_flow_library (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 url text not null unique, kind text not null check(kind in ('posts','stories','cover')),
 folder text not null default '', caption text not null default '' check(length(caption)<=2200),
 created_at timestamptz not null default now(), retired boolean not null default false,
 check(url like 'storage://' || user_id::text || '/%'), check(url not like '%..%')
);
create table public.ig_flow_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 folders text[] not null default '{}', captions text[] not null default '{}'
);
create table public.ig_flows (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name)<=120), created_at timestamptz not null default now(),
 settings jsonb not null default '{}', unique(id,user_id)
);
alter table public.ig_publication_jobs add column flow_id uuid,
 add column cover_url text,
 add foreign key(flow_id,user_id) references public.ig_flows(id,user_id);
create index ig_jobs_flow on public.ig_publication_jobs(flow_id);
create index ig_library_owner on public.ig_flow_library(user_id,created_at);
create index ig_flows_owner on public.ig_flows(user_id,created_at);
alter table public.ig_flow_library enable row level security;
alter table public.ig_flow_preferences enable row level security;
alter table public.ig_flows enable row level security;
create policy owner_select on public.ig_flow_library for select to authenticated using((select auth.uid())=user_id);
create policy owner_insert on public.ig_flow_library for insert to authenticated with check((select auth.uid())=user_id and not retired);
create policy owner_update on public.ig_flow_library for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy owner_preferences on public.ig_flow_preferences for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy owner_flows on public.ig_flows for select to authenticated using((select auth.uid())=user_id);
revoke all on public.ig_flow_library,public.ig_flow_preferences,public.ig_flows from anon,authenticated;
grant select,insert on public.ig_flow_library to authenticated;
grant update(folder,caption) on public.ig_flow_library to authenticated;
grant select,insert,update on public.ig_flow_preferences to authenticated;
grant select on public.ig_flows to authenticated;
grant all on public.ig_flow_library,public.ig_flow_preferences,public.ig_flows to service_role;
-- Called only after server validation. Flow and jobs commit together; stable IDs make retries safe.
create function public.ig_create_flow(p_user uuid,p_id uuid,p_name text,p_settings jsonb,p_jobs jsonb)
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
 insert into public.ig_publication_jobs(id,user_id,account_id,caption,format,media_urls,scheduled_at,flow_id,cover_url)
 select (j->>'id')::uuid,p_user,(j->>'account_id')::uuid,j->>'caption',j->>'format',
 array(select jsonb_array_elements_text(j->'media_urls')),(j->>'scheduled_at')::timestamptz,p_id,nullif(j->>'cover_url','')
 from jsonb_array_elements(p_jobs) j;
end; $$;
revoke all on function public.ig_create_flow(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ig_create_flow(uuid,uuid,text,jsonb,jsonb) to service_role;
commit;
-- Retire first under the same per-owner lock as flow creation. Failed/uncertain
-- jobs and drafts retain their media; deletion retries on subsequent worker ticks.
create function public.ig_retire_flow_media() returns void language plpgsql security invoker set search_path='' as $$
declare owner_id uuid;
begin
 for owner_id in select distinct user_id from public.ig_flow_library loop
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
  update public.ig_flow_library m set retired=true where m.user_id=owner_id and not m.retired
  and exists(select 1 from public.ig_publication_jobs j where j.flow_id is not null and j.status='published' and (m.url=any(j.media_urls) or m.url=j.cover_url))
  and not exists(select 1 from public.ig_publication_jobs j where j.status not in ('published','cancelled') and (m.url=any(j.media_urls) or m.url=j.cover_url))
  and not exists(select 1 from public.instagram_publication_drafts d where d.status<>'cancelled' and m.url=any(d.media_urls));
 end loop;
end; $$;
revoke all on function public.ig_retire_flow_media() from public,anon,authenticated;
grant execute on function public.ig_retire_flow_media() to service_role;

commit;
