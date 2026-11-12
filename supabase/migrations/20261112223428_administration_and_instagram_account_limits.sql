begin;
create table public.avanca_admins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create table public.avanca_user_limits (
 user_id uuid primary key references auth.users(id) on delete cascade,
 connection_allowed boolean not null default true,
 max_accounts integer check(max_accounts between 0 and 10000),
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null
);
alter table public.avanca_admins enable row level security;
alter table public.avanca_user_limits enable row level security;
revoke all on public.avanca_admins,public.avanca_user_limits from anon,authenticated;
grant all on public.avanca_admins,public.avanca_user_limits to service_role;
grant select on public.avanca_user_limits to authenticated;
create policy admin_server_only on public.avanca_admins to service_role using(true) with check(true);
create policy limits_server_access on public.avanca_user_limits to service_role using(true) with check(true);
create policy limits_owner_read on public.avanca_user_limits for select to authenticated using((select auth.uid())=user_id);

-- Policy changes and account inserts take the same lock, so concurrent connections cannot exceed a quota.
create function public.avanca_enforce_connection_limit() returns trigger language plpgsql security invoker set search_path='' as $$
declare policy public.avanca_user_limits; linked integer;
begin
 if tg_op='UPDATE' and new.user_id=old.user_id then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('avanca-account-limit:'||new.user_id::text,0));
 if exists(select 1 from public.ig_publisher_connections c where c.account_id=new.account_id and c.user_id=new.user_id) then return new; end if;
 select * into policy from public.avanca_user_limits where user_id=new.user_id;
 if not found then return new; end if; -- Preserve existing access until an administrator sets a policy.
 if not policy.connection_allowed then raise exception 'account_connection_disabled'; end if;
 if policy.max_accounts is not null then
  select count(*) into linked from public.ig_publisher_connections where user_id=new.user_id;
  if linked>=policy.max_accounts then raise exception 'account_limit_reached'; end if;
 end if;
 return new;
end; $$;
revoke all on function public.avanca_enforce_connection_limit() from public,anon,authenticated;
grant execute on function public.avanca_enforce_connection_limit() to service_role;
create trigger avanca_connection_limit before insert or update of user_id on public.ig_publisher_connections for each row execute function public.avanca_enforce_connection_limit();

create function public.avanca_user_access(p_user uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('is_admin',exists(select 1 from public.avanca_admins where user_id=p_user),
 'connected_accounts',(select count(*) from public.ig_publisher_connections where user_id=p_user),
 'connection_allowed',coalesce((select connection_allowed from public.avanca_user_limits where user_id=p_user),true),
 'max_accounts',(select max_accounts from public.avanca_user_limits where user_id=p_user));
$$;
-- These two server-only helpers require auth.users access, which service_role intentionally lacks.
-- Keep EXECUTE revoked from browser roles and pin search_path for the privileged operations.
create function public.avanca_admin_users(p_actor uuid,p_search text default '',p_page integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.avanca_admins where user_id=p_actor) then raise exception 'forbidden'; end if;
 if p_page<1 or p_page>100000 or length(p_search)>100 then raise exception 'invalid_request'; end if;
 select jsonb_build_object('users',coalesce((select jsonb_agg(x) from(
  select u.id,u.email,coalesce(p.display_name,'') as display_name,u.created_at,
  (select count(*) from public.ig_publisher_connections c where c.user_id=u.id) as connected_accounts,
  coalesce(l.connection_allowed,true) as connection_allowed,l.max_accounts,l.updated_at,
  exists(select 1 from public.avanca_admins a where a.user_id=u.id) as is_admin
  from auth.users u left join public.profiles p on p.user_id=u.id left join public.avanca_user_limits l on l.user_id=u.id
  where coalesce(u.email,'') ilike '%'||p_search||'%' or coalesce(p.display_name,'') ilike '%'||p_search||'%'
  order by u.created_at desc,u.id limit 50 offset (p_page-1)*50
 ) x),'[]'::jsonb),
 'total',(select count(*) from auth.users u left join public.profiles p on p.user_id=u.id where coalesce(u.email,'') ilike '%'||p_search||'%' or coalesce(p.display_name,'') ilike '%'||p_search||'%'),
 'summary',jsonb_build_object('users',(select count(*) from auth.users),'accounts',(select count(*) from public.ig_publisher_connections),'blocked',(select count(*) from public.avanca_user_limits where not connection_allowed))) into result;
 return result;
end; $$;
create function public.avanca_admin_update_access(p_actor uuid,p_target uuid,p_allowed boolean,p_max integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.avanca_admins where user_id=p_actor) then raise exception 'forbidden'; end if;
 if p_allowed is null or (p_max is not null and (p_max<0 or p_max>10000)) then raise exception 'invalid_limit'; end if;
 if not exists(select 1 from auth.users where id=p_target) then raise exception 'user_not_found'; end if;
 perform pg_advisory_xact_lock(hashtextextended('avanca-account-limit:'||p_target::text,0));
 insert into public.avanca_user_limits(user_id,connection_allowed,max_accounts,updated_at,updated_by)
 values(p_target,p_allowed,p_max,now(),p_actor)
 on conflict(user_id) do update set connection_allowed=excluded.connection_allowed,max_accounts=excluded.max_accounts,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
end; $$;
revoke all on function public.avanca_user_access(uuid),public.avanca_admin_users(uuid,text,integer),public.avanca_admin_update_access(uuid,uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.avanca_user_access(uuid),public.avanca_admin_users(uuid,text,integer),public.avanca_admin_update_access(uuid,uuid,boolean,integer) to service_role;
commit;
