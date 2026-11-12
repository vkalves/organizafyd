begin;
alter table public.avanca_user_limits alter column max_accounts set default 10;
create or replace function public.avanca_enforce_connection_limit() returns trigger language plpgsql security invoker set search_path='' as $$
declare policy public.avanca_user_limits; linked integer;
begin
 if tg_op='UPDATE' and new.user_id=old.user_id then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('avanca-account-limit:'||new.user_id::text,0));
 if exists(select 1 from public.ig_publisher_connections c where c.account_id=new.account_id and c.user_id=new.user_id) then return new; end if;
 select * into policy from public.avanca_user_limits where user_id=new.user_id;
 if not found then
  policy.connection_allowed := true;
  policy.max_accounts := 10;
 end if; -- New users inherit the ten-account default without requiring an Auth trigger.
 if not policy.connection_allowed then raise exception 'account_connection_disabled'; end if;
 if policy.max_accounts is not null then
  select count(*) into linked from public.ig_publisher_connections where user_id=new.user_id;
  if linked>=policy.max_accounts then raise exception 'account_limit_reached'; end if;
 end if;
 return new;
end; $$;
create or replace function public.avanca_user_access(p_user uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('is_admin',exists(select 1 from public.avanca_admins where user_id=p_user),
 'connected_accounts',(select count(*) from public.ig_publisher_connections where user_id=p_user),
 'connection_allowed',coalesce((select connection_allowed from public.avanca_user_limits where user_id=p_user),true),
 'max_accounts',case when exists(select 1 from public.avanca_user_limits where user_id=p_user) then (select max_accounts from public.avanca_user_limits where user_id=p_user) else 10 end);
$$;
create or replace function public.avanca_admin_users(p_actor uuid,p_search text default '',p_page integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.avanca_admins where user_id=p_actor) then raise exception 'forbidden'; end if;
 if p_page<1 or p_page>100000 or length(p_search)>100 then raise exception 'invalid_request'; end if;
 select jsonb_build_object('users',coalesce((select jsonb_agg(x) from(
  select u.id,u.email,coalesce(p.display_name,'') as display_name,u.created_at,
  (select count(*) from public.ig_publisher_connections c where c.user_id=u.id) as connected_accounts,
  coalesce(l.connection_allowed,true) as connection_allowed,case when l.user_id is null then 10 else l.max_accounts end as max_accounts,l.updated_at,
  exists(select 1 from public.avanca_admins a where a.user_id=u.id) as is_admin
  from auth.users u left join public.profiles p on p.user_id=u.id left join public.avanca_user_limits l on l.user_id=u.id
  where coalesce(u.email,'') ilike '%'||p_search||'%' or coalesce(p.display_name,'') ilike '%'||p_search||'%'
  order by u.created_at desc,u.id limit 50 offset (p_page-1)*50
 ) x),'[]'::jsonb),
 'total',(select count(*) from auth.users u left join public.profiles p on p.user_id=u.id where coalesce(u.email,'') ilike '%'||p_search||'%' or coalesce(p.display_name,'') ilike '%'||p_search||'%'),
 'summary',jsonb_build_object('users',(select count(*) from auth.users),'accounts',(select count(*) from public.ig_publisher_connections),'blocked',(select count(*) from public.avanca_user_limits where not connection_allowed))) into result;
 return result;
end; $$;
commit;
