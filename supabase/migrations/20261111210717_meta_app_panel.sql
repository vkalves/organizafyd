-- Only the authenticated Edge Function's service role can write platform credentials.
create or replace function public.ig_save_login_config(p_app_id text, p_config_id text, p_secret text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare item record; secret_id uuid;
begin
  if p_app_id !~ '^[0-9]{5,40}$' or p_config_id !~ '^[0-9]{5,40}$'
     or p_app_id is null or p_config_id is null
     or (p_secret is not null and p_secret !~ '^[a-fA-F0-9]{32}$') then
    raise exception 'invalid_app_config';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ig_meta_app_config', 0));
  if p_secret is null and not exists(select 1 from vault.secrets where name='meta_app_secret') then
    raise exception 'app_secret_required';
  end if;
  if p_secret is null and not exists(select 1 from vault.decrypted_secrets where name='meta_app_id' and decrypted_secret=p_app_id) then
    raise exception 'app_secret_required';
  end if;
  for item in select * from (values ('meta_app_id',p_app_id),('meta_config_id',p_config_id),('meta_app_secret',p_secret)) as v(name,value)
  loop
    if item.value is not null then
      select id into secret_id from vault.secrets where name=item.name;
      if secret_id is null then
        perform vault.create_secret(item.value,item.name);
      else
        perform vault.update_secret(secret_id,item.value);
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function public.ig_save_login_config(text,text,text) from public,anon,authenticated;
grant execute on function public.ig_save_login_config(text,text,text) to service_role;
