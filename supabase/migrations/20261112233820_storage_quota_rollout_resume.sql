-- Apply only after the S3 inventory is reconciled and the final gateway is deployed.
begin;
drop trigger if exists avanca_storage_rollout_pause on storage.objects;
drop function if exists avanca_storage_private.pause_quota_rollout();
commit;
