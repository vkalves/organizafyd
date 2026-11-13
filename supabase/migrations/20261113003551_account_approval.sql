begin;
create schema if not exists avanca_approval_private;
revoke all on schema avanca_approval_private from public,anon,authenticated;
grant usage on schema avanca_approval_private to authenticated;
-- Existing accounts retain access. The Auth trigger marks all subsequent signups pending.
create table public.avanca_account_approvals (
 user_id uuid primary key references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 reviewed_at timestamptz,
 reviewed_by uuid references auth.users(id) on delete set null
);
alter table public.avanca_account_approvals enable row level security;
revoke all on public.avanca_account_approvals from public,anon,authenticated;
grant select on public.avanca_account_approvals to authenticated;
grant all on public.avanca_account_approvals to service_role;
create policy own_approval_read on public.avanca_account_approvals for select to authenticated using(user_id=(select auth.uid()));
create policy approval_server on public.avanca_account_approvals to service_role using(true) with check(true);
lock table auth.users in share row exclusive mode;
insert into public.avanca_account_approvals(user_id,status) select id,'approved' from auth.users;

create function avanca_approval_private.register_pending_account() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.avanca_account_approvals(user_id,status) values(new.id,'pending');
 return new;
end; $$;
revoke all on function avanca_approval_private.register_pending_account() from public,anon,authenticated;
create trigger avanca_new_account_pending after insert on auth.users for each row execute function avanca_approval_private.register_pending_account();

-- Only the server can ask for another user's status. Missing entries fail closed.
create function public.avanca_account_status(p_user uuid) returns text language sql stable security invoker set search_path='' as $$
 select case when exists(select 1 from public.avanca_admins where user_id=p_user) then 'approved'
 else coalesce((select status from public.avanca_account_approvals where user_id=p_user),'pending') end;
$$;
revoke all on function public.avanca_account_status(uuid) from public,anon,authenticated;
grant execute on function public.avanca_account_status(uuid) to service_role;

-- The browser helper has no target argument, reveals only its own boolean and
-- performs an explicit identity check. It cannot be used to inspect other users.
create function avanca_approval_private.account_is_approved() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.avanca_account_status(auth.uid())='approved';
$$;
revoke all on function avanca_approval_private.account_is_approved() from public,anon;
grant execute on function avanca_approval_private.account_is_approved() to authenticated;

create function public.avanca_admin_review_account(p_actor uuid,p_target uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.avanca_admins where user_id=p_actor) then raise exception 'forbidden'; end if;
 if p_status is null or p_status not in ('approved','rejected') then raise exception 'invalid_approval'; end if;
 if exists(select 1 from public.avanca_admins where user_id=p_target) then raise exception 'account_not_pending'; end if;
 if not exists(select 1 from auth.users where id=p_target) then raise exception 'user_not_found'; end if;
 -- A concurrent second decision cannot overwrite the first. Rejected accounts
 -- can later be approved, but approved accounts are never revoked by this flow.
 update public.avanca_account_approvals set status=p_status,reviewed_at=now(),reviewed_by=p_actor
 where user_id=p_target and (status='pending' or (status='rejected' and p_status='approved'));
 if not found then raise exception 'account_not_pending'; end if;
end; $$;
revoke all on function public.avanca_admin_review_account(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.avanca_admin_review_account(uuid,uuid,text) to service_role;

create function public.avanca_admin_pending_accounts(p_actor uuid,p_page integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.avanca_admins where user_id=p_actor) then raise exception 'forbidden'; end if;
 if p_page is null or p_page<1 or p_page>100000 then raise exception 'invalid_request'; end if;
 return jsonb_build_object('users',coalesce((select jsonb_agg(x) from (
  select u.id,u.email,coalesce(p.display_name,'') as display_name,u.created_at,a.status as account_status,false as is_admin
  from public.avanca_account_approvals a join auth.users u on u.id=a.user_id
  left join public.profiles p on p.user_id=u.id
  where a.status='pending' and not exists(select 1 from public.avanca_admins ad where ad.user_id=u.id)
  order by u.created_at,u.id limit 50 offset (p_page-1)*50
 ) x),'[]'::jsonb),'total',(select count(*) from public.avanca_account_approvals a where status='pending' and not exists(select 1 from public.avanca_admins ad where ad.user_id=a.user_id)));
end; $$;
revoke all on function public.avanca_admin_pending_accounts(uuid,integer) from public,anon,authenticated;
grant execute on function public.avanca_admin_pending_accounts(uuid,integer) to service_role;

-- Restrictive policies combine with the existing ownership policies, and also
-- protect direct REST/Realtime/Storage access with an already issued JWT.
do $$ declare t record; begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind='r' and c.relrowsecurity and (n.nspname='public' or (n.nspname='storage' and c.relname='objects'))
 and c.relname<>'avanca_account_approvals'
 loop
  execute format('create policy account_approval_required on %I.%I as restrictive for all to authenticated using ((select avanca_approval_private.account_is_approved())) with check ((select avanca_approval_private.account_is_approved()))',t.nspname,t.relname);
 end loop;
end $$;

-- Service-role OAuth callbacks also cannot create connections for pending accounts.
create function public.avanca_check_connection_approval() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if public.avanca_account_status(new.user_id)<>'approved' then raise exception 'account_not_approved'; end if;
 return new;
end; $$;
revoke all on function public.avanca_check_connection_approval() from public,anon,authenticated;
grant execute on function public.avanca_check_connection_approval() to service_role;
create trigger avanca_connection_approval before insert or update of user_id on public.ig_publisher_connections for each row execute function public.avanca_check_connection_approval();

create or replace function public.avanca_user_access(p_user uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('is_admin',exists(select 1 from public.avanca_admins where user_id=p_user),
 'account_status',public.avanca_account_status(p_user),
 'connected_accounts',(select count(*) from public.ig_publisher_connections where user_id=p_user),
 'connection_allowed',coalesce((select connection_allowed from public.avanca_user_limits where user_id=p_user),true),
 'max_accounts',case when exists(select 1 from public.avanca_user_limits where user_id=p_user) then (select max_accounts from public.avanca_user_limits where user_id=p_user) else 10 end) || public.avanca_storage_access(p_user);
$$;
create or replace function public.avanca_admin_users(p_actor uuid,p_search text default '',p_page integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.avanca_admins where user_id=p_actor) then raise exception 'forbidden'; end if;
 if p_page<1 or p_page>100000 or length(p_search)>100 then raise exception 'invalid_request'; end if;
 select jsonb_build_object('users',coalesce((select jsonb_agg(x) from(
  select public.avanca_account_status(u.id) as account_status,u.id,u.email,coalesce(p.display_name,'') as display_name,u.created_at,
  (select count(*) from public.ig_publisher_connections c where c.user_id=u.id) as connected_accounts,
  coalesce(l.connection_allowed,true) as connection_allowed,case when l.user_id is null then 10 else l.max_accounts end as max_accounts,l.updated_at,
  exists(select 1 from public.avanca_admins a where a.user_id=u.id) as is_admin,
  avanca_storage_private.limit_bytes(u.id) as storage_limit_bytes,
  avanca_storage_private.used_bytes(u.id) as storage_used_bytes
  from auth.users u left join public.profiles p on p.user_id=u.id left join public.avanca_user_limits l on l.user_id=u.id
  where coalesce(u.email,'') ilike '%'||p_search||'%' or coalesce(p.display_name,'') ilike '%'||p_search||'%'
  order by u.created_at desc,u.id limit 50 offset (p_page-1)*50
 ) x),'[]'::jsonb),
 'total',(select count(*) from auth.users u left join public.profiles p on p.user_id=u.id where coalesce(u.email,'') ilike '%'||p_search||'%' or coalesce(p.display_name,'') ilike '%'||p_search||'%'),
 'summary',jsonb_build_object('users',(select count(*) from auth.users),'accounts',(select count(*) from public.ig_publisher_connections),'blocked',(select count(*) from public.avanca_user_limits where not connection_allowed))) into result;
 return result;
end; $$;

commit;
