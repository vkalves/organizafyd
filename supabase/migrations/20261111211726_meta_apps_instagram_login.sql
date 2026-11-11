-- Each user's apps and secrets are private. Only verified Edge Function calls use these RPCs.
create table public.ig_meta_apps (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 80),
 app_id text not null check(app_id ~ '^[0-9]{5,40}$'),
 config_id text check(config_id ~ '^[0-9]{5,40}$'),
 secret_id uuid not null references vault.secrets(id),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(user_id,app_id), unique(id,user_id)
);
alter table public.ig_meta_apps enable row level security;
revoke all on public.ig_meta_apps from public,anon,authenticated;
grant all on public.ig_meta_apps to service_role;
create index ig_meta_apps_owner on public.ig_meta_apps(user_id);
alter table public.ig_connection_invites add column meta_app_id uuid references public.ig_meta_apps(id);
alter table public.ig_login_states add column meta_app_id uuid references public.ig_meta_apps(id);
alter table public.ig_publisher_connections add column meta_app_id uuid;
alter table public.ig_publisher_connections add constraint ig_connection_app_owner foreign key(meta_app_id,user_id) references public.ig_meta_apps(id,user_id);

create function public.ig_meta_apps_manage(p_user uuid,p_action text,p_values jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.ig_meta_apps%rowtype; app uuid; secret uuid;
 label text; appid text; configid text; appsecret text;
begin
 if p_user is null then raise exception 'unauthorized'; end if;
 if p_action <> 'list' then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text||':meta-apps',0));
 end if;
 if p_action in ('save','toggle','delete') then
  if p_values->>'id' is not null then
   select * into target from public.ig_meta_apps where id=(p_values->>'id')::uuid and user_id=p_user for update;
   if not found then raise exception 'app_not_found'; end if;
  elsif p_action <> 'save' then raise exception 'app_not_found'; end if;
 end if;
 if p_action='save' then
  label:=trim(p_values->>'name'); appid:=trim(p_values->>'appId');
  configid:=nullif(trim(p_values->>'configId'),''); appsecret:=nullif(trim(p_values->>'appSecret'),'');
  if coalesce(length(label),0) not between 1 and 80 or appid is null or appid !~ '^[0-9]{5,40}$'
    or (configid is not null and configid !~ '^[0-9]{5,40}$')
    or (appsecret is not null and appsecret !~ '^[a-fA-F0-9]{32}$') then raise exception 'invalid_app_config'; end if;
  if (target.id is null or target.app_id<>appid) and appsecret is null then raise exception 'app_secret_required'; end if;
  if target.id is not null and (target.app_id<>appid or (target.config_id is null)<>(configid is null))
   and exists(select 1 from public.ig_publisher_connections where meta_app_id=target.id) then raise exception 'app_in_use'; end if;
  if target.id is null then
   secret:=vault.create_secret(appsecret);
   insert into public.ig_meta_apps(user_id,name,app_id,config_id,secret_id) values(p_user,label,appid,configid,secret) returning id into app;
  else
   if appsecret is not null then perform vault.update_secret(target.secret_id,appsecret); end if;
   update public.ig_meta_apps set name=label,app_id=appid,config_id=configid where id=target.id;
  end if;
 elsif p_action='toggle' then
  update public.ig_meta_apps set active=not active where id=target.id;
 elsif p_action='delete' then
  if exists(select 1 from public.ig_publisher_connections where meta_app_id=target.id) then raise exception 'app_in_use'; end if;
  delete from public.ig_connection_invites where meta_app_id=target.id;
  delete from public.ig_login_states where meta_app_id=target.id;
  delete from public.ig_meta_apps where id=target.id;
  delete from vault.secrets where id=target.secret_id;
 elsif p_action<>'list' then raise exception 'unknown_action'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'appId',a.app_id,
   'configId',coalesce(a.config_id,''),'active',a.active,'createdAt',a.created_at,'secretConfigured',true,
   'accountCount',(select count(*) from public.ig_publisher_connections c where c.meta_app_id=a.id and c.user_id=p_user)) order by a.created_at)
  from public.ig_meta_apps a where a.user_id=p_user),'[]'::jsonb);
end; $$;
revoke all on function public.ig_meta_apps_manage(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ig_meta_apps_manage(uuid,text,jsonb) to service_role;

create function public.ig_meta_app_config(p_user uuid,p_id uuid) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('id',a.id,'appId',a.app_id,'configId',a.config_id,'secret',v.decrypted_secret,'name',a.name,'active',a.active)
 from public.ig_meta_apps a join vault.decrypted_secrets v on v.id=a.secret_id
 where a.id=p_id and a.user_id=p_user;
$$;
revoke all on function public.ig_meta_app_config(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ig_meta_app_config(uuid,uuid) to service_role;

create function public.ig_connect_meta_app(p_user uuid,p_app uuid,p_graph text,p_username text,p_token text,p_business text,p_expires timestamptz,p_app_client_id text,p_config_id text)
returns uuid language plpgsql security definer set search_path='' as $$
declare app public.ig_meta_apps%rowtype; account uuid;
begin
 select * into app from public.ig_meta_apps where id=p_app and user_id=p_user for share;
 if not found or not app.active then raise exception 'app_not_found'; end if;
 if app.app_id is distinct from p_app_client_id or app.config_id is distinct from nullif(p_config_id,'') then raise exception 'invalid_state'; end if;
 account:=public.ig_connect_account(p_user,p_graph,p_username,p_token);
 update public.ig_publisher_connections set meta_app_id=app.id,
 provider=case when app.config_id is null then 'instagram' else 'facebook' end,
 token_expires_at=p_expires,client_business_id=p_business where account_id=account and user_id=p_user;
 return account;
end; $$;
revoke all on function public.ig_connect_meta_app(uuid,uuid,text,text,text,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.ig_connect_meta_app(uuid,uuid,text,text,text,text,timestamptz,text,text) to service_role;
