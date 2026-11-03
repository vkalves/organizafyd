create or replace function public.ig_login_config() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_object_agg(name,decrypted_secret) from vault.decrypted_secrets where name in ('meta_app_id','meta_app_secret','meta_config_id');
$$;
revoke all on function public.ig_login_config() from public,anon,authenticated;
grant execute on function public.ig_login_config() to service_role;
alter table public.ig_publisher_connections add column client_business_id text;
create function public.ig_connect_unified(p_user uuid,p_graph text,p_username text,p_token text,p_business text,p_expires timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid; existing_provider text;
begin
 if p_business is null or p_business !~ '^[0-9]+$' then raise exception 'invalid_business'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_graph,0));
 select provider into existing_provider from public.ig_publisher_connections where graph_id=p_graph;
 if existing_provider='instagram' then raise exception 'provider_conflict'; end if;
 a:=public.ig_connect_account(p_user,p_graph,p_username,p_token);
 update public.ig_publisher_connections set provider='facebook',client_business_id=p_business,token_expires_at=p_expires where account_id=a;
 return a;
end; $$;
revoke all on function public.ig_connect_unified(uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.ig_connect_unified(uuid,text,text,text,text,timestamptz) to service_role;
