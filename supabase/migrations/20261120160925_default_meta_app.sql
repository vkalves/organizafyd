-- Store one active default per owner; existing accounts and credentials stay linked to their app.
alter table public.ig_meta_apps add column is_default boolean not null default false;
alter table public.ig_meta_apps add constraint ig_meta_apps_default_active check (not is_default or active);
create unique index ig_meta_apps_one_default_per_owner on public.ig_meta_apps(user_id) where is_default;

create or replace function public.ig_meta_apps_manage(p_user uuid,p_action text,p_values jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.ig_meta_apps%rowtype; app uuid; secret uuid;
 label text; appid text; configid text; appsecret text;
begin
 if p_user is null then raise exception 'unauthorized'; end if;
 if p_action <> 'list' then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text||':meta-apps',0));
 end if;
 if p_action in ('save','toggle','delete','set_default') then
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
 elsif p_action='set_default' then
  if not target.active then raise exception 'app_not_found'; end if;
  update public.ig_meta_apps set is_default=false where user_id=p_user and is_default;
  update public.ig_meta_apps set is_default=true where id=target.id;
 elsif p_action='toggle' then
  update public.ig_meta_apps set active=not active, is_default=false where id=target.id;
 elsif p_action='delete' then
  if exists(select 1 from public.ig_publisher_connections where meta_app_id=target.id) then raise exception 'app_in_use'; end if;
  delete from public.ig_connection_invites where meta_app_id=target.id;
  delete from public.ig_login_states where meta_app_id=target.id;
  delete from public.ig_meta_apps where id=target.id;
  delete from vault.secrets where id=target.secret_id;
 elsif p_action<>'list' then raise exception 'unknown_action'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'appId',a.app_id,
   'configId',coalesce(a.config_id,''),'active',a.active,'isDefault',a.is_default,'createdAt',a.created_at,'secretConfigured',true,
   'accountCount',(select count(*) from public.ig_publisher_connections c where c.meta_app_id=a.id and c.user_id=p_user)) order by a.created_at)
  from public.ig_meta_apps a where a.user_id=p_user),'[]'::jsonb);
end; $$;
revoke all on function public.ig_meta_apps_manage(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ig_meta_apps_manage(uuid,text,jsonb) to service_role;

