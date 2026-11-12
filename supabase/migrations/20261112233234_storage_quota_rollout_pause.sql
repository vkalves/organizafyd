-- Deploy this pause BEFORE user_media_storage_quotas on a live installation.
-- Reads, publishing of existing files and deletions remain available.
begin;
create schema if not exists avanca_storage_private;
revoke all on schema avanca_storage_private from public,anon,authenticated;
create function avanca_storage_private.pause_quota_rollout() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.bucket_id in ('media','instagram-publisher','x-media','tiktok-media') then raise exception 'storage_maintenance'; end if;
 return new;
end; $$;
revoke all on function avanca_storage_private.pause_quota_rollout() from public,anon,authenticated;
create trigger avanca_storage_rollout_pause before insert or update of bucket_id,name,metadata on storage.objects for each row execute function avanca_storage_private.pause_quota_rollout();
commit;
