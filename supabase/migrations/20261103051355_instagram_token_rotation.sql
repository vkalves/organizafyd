create function public.ig_replace_token(p_account uuid,p_token text) returns void language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 select secret_id into strict target from public.ig_publisher_connections where account_id=p_account;
 perform vault.update_secret(target,p_token);
 update public.ig_publisher_connections set reconnect_required=false where account_id=p_account;
end; $$;
revoke all on function public.ig_replace_token(uuid,text) from public,anon,authenticated;
grant execute on function public.ig_replace_token(uuid,text) to service_role;
