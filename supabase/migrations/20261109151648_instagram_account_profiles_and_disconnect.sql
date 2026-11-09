begin;
-- Private tombstones let a later OAuth connection reuse the same account/history.
create table public.ig_disconnected_accounts (
  account_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  graph_id text not null check (graph_id ~ '^[0-9]+$'),
  removed_at timestamptz not null default now(),
  unique(user_id, graph_id),
  foreign key(account_id,user_id) references public.instagram_accounts(id,user_id) on delete cascade
);
alter table public.ig_disconnected_accounts enable row level security;
revoke all on public.ig_disconnected_accounts from public,anon,authenticated;
grant all on public.ig_disconnected_accounts to service_role;

-- Serialize all new jobs with removal, including single-post scheduling.
create function public.ig_require_live_connection() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.status not in ('scheduled','processing') then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text,0));
  if not exists(select 1 from public.ig_publisher_connections c where c.account_id=new.account_id and c.user_id=new.user_id and not c.reconnect_required) then
    raise exception 'account_not_connected';
  end if;
  return new;
end; $$;
revoke all on function public.ig_require_live_connection() from public,anon,authenticated;
grant execute on function public.ig_require_live_connection() to service_role;
create trigger ig_require_live_connection before insert on public.ig_publication_jobs
for each row execute function public.ig_require_live_connection();

create function public.ig_disconnect_account(p_user uuid,p_account uuid) returns void
language plpgsql security invoker set search_path='' as $$
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
  perform 1 from public.ig_publication_jobs where account_id=p_account and user_id=p_user and status in ('scheduled','processing') order by id for update;
  if exists(select 1 from public.ig_publication_jobs where account_id=p_account and user_id=p_user and status='processing') then
    raise exception 'account_busy';
  end if;
  update public.ig_publication_jobs set status='cancelled',error_code='account_disconnected' where account_id=p_account and user_id=p_user and status='scheduled';
  for flow in select id,settings from public.ig_flows where user_id=p_user and settings->'accountIds' ? p_account::text order by id for update loop
    select coalesce(jsonb_agg(value),'[]'::jsonb) into remaining from jsonb_array_elements_text(flow.settings->'accountIds') as ids(value) where value<>p_account::text;
    update public.ig_flows set settings=jsonb_set(flow.settings,'{accountIds}',remaining),state=case when jsonb_array_length(remaining)=0 then 'stopped' else state end where id=flow.id and user_id=p_user;
  end loop;
  insert into public.ig_disconnected_accounts(account_id,user_id,graph_id) values(p_account,p_user,v_graph)
  on conflict(account_id) do update set removed_at=now();
  delete from public.ig_publisher_connections where account_id=p_account and user_id=p_user;
  delete from vault.secrets s where s.id=v_secret and not exists(select 1 from public.ig_publisher_connections c where c.secret_id=s.id);
end; $$;
revoke all on function public.ig_disconnect_account(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ig_disconnect_account(uuid,uuid) to service_role;

-- Retains the existing service-only Vault writer and ownership validation.
create or replace function public.ig_connect_account(p_user uuid,p_graph text,p_username text,p_token text)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.ig_publisher_connections%rowtype; account uuid; secret uuid;
begin
  if p_user is null or p_graph is null or p_graph !~ '^[0-9]{5,30}$' or coalesce(length(p_username),0)=0 or coalesce(length(p_token),0)=0 or length(p_token)>4096 then raise exception 'invalid_connection'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_graph,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text,0));
  select * into existing from public.ig_publisher_connections where graph_id=p_graph for update;
  if found then
    if existing.user_id<>p_user then raise exception 'account_already_connected'; end if;
    perform vault.update_secret(existing.secret_id,p_token);
    update public.ig_publisher_connections set reconnect_required=false where account_id=existing.account_id;
    update public.instagram_accounts set username=p_username where id=existing.account_id and user_id=p_user;
    return existing.account_id;
  end if;
  select account_id into account from public.ig_disconnected_accounts where graph_id=p_graph and user_id=p_user for update;
  if found then
    update public.instagram_accounts set username=p_username,avatar_url=null where id=account and user_id=p_user;
    delete from public.ig_disconnected_accounts where account_id=account and user_id=p_user;
  else
    insert into public.instagram_accounts(user_id,username,name,status) values(p_user,p_username,p_username,'active') returning id into account;
  end if;
  secret:=vault.create_secret(p_token);
  insert into public.ig_publisher_connections(account_id,user_id,graph_id,secret_id) values(account,p_user,p_graph,secret);
  return account;
end; $$;
revoke all on function public.ig_connect_account(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.ig_connect_account(uuid,text,text,text) to service_role;
commit;
