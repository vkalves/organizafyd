-- Server-only access to encrypted S3 configuration. Never expose this to clients.
create or replace function public.aws_storage_config()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return (select decrypted_secret::jsonb from vault.decrypted_secrets where name = 'avanca_aws_storage' limit 1);
end;
$$;
revoke all on function public.aws_storage_config() from public, anon, authenticated;
grant execute on function public.aws_storage_config() to service_role;
comment on function public.aws_storage_config() is 'Server-only S3 configuration, encrypted in Supabase Vault; never grant to anon/authenticated.';
