-- Called only by the authenticated Edge Function with the verified Meta profile.
-- Create account + encrypted credential atomically; never transfer ownership.
create function public.ig_connect_account(p_user uuid, p_graph text, p_username text, p_token text)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.ig_publisher_connections%rowtype;
        account uuid;
        secret uuid;
begin
 if p_user is null or p_graph is null or p_graph !~ '^[0-9]{5,30}$'
    or coalesce(length(p_username),0)=0 or coalesce(length(p_token),0)=0
    or length(p_token)>4096 then raise exception 'invalid_connection'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_graph, 0));
 select * into existing from public.ig_publisher_connections where graph_id=p_graph for update;
 if found then
   if existing.user_id<>p_user then raise exception 'account_already_connected'; end if;
   perform vault.update_secret(existing.secret_id,p_token);
   update public.ig_publisher_connections set reconnect_required=false where account_id=existing.account_id;
   update public.instagram_accounts set username=p_username where id=existing.account_id and user_id=p_user;
   return existing.account_id;
 end if;
 insert into public.instagram_accounts(user_id,username,name,status)
 values(p_user,p_username,p_username,'active') returning id into account;
 secret := vault.create_secret(p_token);
 insert into public.ig_publisher_connections(account_id,user_id,graph_id,secret_id)
 values(account,p_user,p_graph,secret);
 return account;
end; $$;
revoke all on function public.ig_connect_account(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.ig_connect_account(uuid,text,text,text) to service_role;
