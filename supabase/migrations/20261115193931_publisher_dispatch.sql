begin;
-- Endpoint discovery preserves the project's existing URLs and Vault secrets.
create table public.publisher_worker_endpoints (
 platform text primary key check(platform in ('instagram','x','tiktok')), url text not null check(url ~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/[a-z-]+$')
);
alter table public.publisher_worker_endpoints enable row level security;
revoke all on public.publisher_worker_endpoints from public,anon,authenticated;
grant select,insert,update,delete on public.publisher_worker_endpoints to service_role;
insert into public.publisher_worker_endpoints(platform,url)
select 'instagram',substring(command from 'https://[a-z0-9]+[.]supabase[.]co') || '/functions/v1/instagram-publisher'
from cron.job where jobname='instagram-publisher';
insert into public.publisher_worker_endpoints(platform,url)
select p, rtrim(decrypted_secret,'/') || '/functions/v1/' || p || '-publisher'
from unnest(array['x','tiktok']) p join vault.decrypted_secrets s on s.name=p || '_project_url';

create function public.publisher_dispatch(p_platform text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare endpoint text; secret text; accounts integer; workers integer; shard integer; requests jsonb:='[]'; request_id bigint;
begin
 if p_platform not in ('instagram','x','tiktok','maintenance') or p_platform is null then raise exception 'invalid_platform'; end if;
 select url into endpoint from public.publisher_worker_endpoints where platform=case when p_platform='maintenance' then 'instagram' else p_platform end;
 select decrypted_secret into secret from vault.decrypted_secrets where name=case when p_platform in ('instagram','maintenance') then 'ig' else p_platform end || '_worker_secret';
 if endpoint is null or secret is null then return jsonb_build_object('workers',0,'configured',false); end if;
 if p_platform='instagram' then
  select count(distinct j.account_id) into accounts from public.ig_publication_jobs j join public.ig_publisher_connections c on c.account_id=j.account_id
  left join public.ig_flows f on f.id=j.flow_id
  where j.status='scheduled' and j.scheduled_at<=now() and j.next_attempt_at<=now()
  and not c.paused and not c.reconnect_required and c.publish_retry_at<=now() and (j.flow_id is null or f.state='active');
 elsif p_platform='x' then
  delete from public.x_oauth_states where expires_at<now();
  update public.x_posts set status='uncertain',error_code='confirmation_required' where status='processing' and started_at<now()-interval '5 minutes';
  select count(distinct p.account_id) into accounts from public.x_posts p join public.x_accounts a on a.id=p.account_id
  where p.status='scheduled' and p.scheduled_at<=now() and not a.paused and not a.reconnect_required;
 elsif p_platform='tiktok' then
  delete from public.tiktok_oauth_states where expires_at<now();
  update public.tiktok_posts set status='uncertain',error_code='confirmation_required' where status='processing' and started_at<now()-interval '5 minutes';
  select count(distinct p.account_id) into accounts from public.tiktok_posts p join public.tiktok_accounts a on a.id=p.account_id
  where ((p.status='scheduled' and p.scheduled_at<=now()) or p.status='submitted') and not a.paused and not a.reconnect_required;
 else accounts:=1;
 end if;
 workers:=least(8,ceil(accounts/20.0)::integer);
 if p_platform='maintenance' then workers:=1; end if;
 for shard in 0..workers-1 loop
  select net.http_post(url:=endpoint,
   headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',secret),
   body:=jsonb_build_object('action',case when p_platform='maintenance' then 'maintenance' when p_platform='instagram' then 'worker' else 'process' end,'shard',shard,'shards',workers),
   timeout_milliseconds:=140000) into request_id;
  requests:=requests || jsonb_build_array(request_id);
 end loop;
 return jsonb_build_object('workers',workers,'due_accounts',accounts,'requests',requests);
end; $$;
revoke all on function public.publisher_dispatch(text) from public,anon,authenticated;
-- Vault and pg_net stay accessible only to the existing cron owner (postgres).

CREATE OR REPLACE FUNCTION public.configure_x_worker(p_project_url text, p_worker_secret text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE secret_id uuid; existing_job bigint;
BEGIN
  IF p_project_url IS NULL OR p_project_url !~ '^https://[a-z0-9]+\.supabase\.co/?$' THEN
    RAISE EXCEPTION 'Expected Supabase HTTPS URL';
  END IF;
  IF p_worker_secret IS NULL OR length(p_worker_secret)<32 OR p_worker_secret ~ '\s' THEN
    RAISE EXCEPTION 'Worker secret must have at least 32 characters';
  END IF;
  SELECT id INTO secret_id FROM vault.secrets WHERE name='x_project_url';
  IF secret_id IS NULL THEN PERFORM vault.create_secret(rtrim(p_project_url,'/'),'x_project_url');
  ELSE PERFORM vault.update_secret(secret_id,rtrim(p_project_url,'/')); END IF;
  SELECT id INTO secret_id FROM vault.secrets WHERE name='x_worker_secret';
  IF secret_id IS NULL THEN PERFORM vault.create_secret(p_worker_secret,'x_worker_secret');
  ELSE PERFORM vault.update_secret(secret_id,p_worker_secret); END IF;
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname='x-publisher'
  LOOP PERFORM cron.unschedule(existing_job); END LOOP;
  PERFORM cron.schedule('x-publisher','* * * * *',$job$ SELECT public.publisher_dispatch('x'); $job$);
END;
$$;
CREATE OR REPLACE FUNCTION public.configure_tiktok_worker(p_project_url text, p_worker_secret text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE secret_id uuid; existing_job bigint;
BEGIN
  IF p_project_url IS NULL OR p_project_url !~ '^https://[a-z0-9]+\.supabase\.co/?$' THEN
    RAISE EXCEPTION 'Expected Supabase HTTPS URL';
  END IF;
  IF p_worker_secret IS NULL OR length(p_worker_secret)<32 OR p_worker_secret ~ '\s' THEN
    RAISE EXCEPTION 'Worker secret must have at least 32 characters';
  END IF;
  SELECT id INTO secret_id FROM vault.secrets WHERE name='tiktok_project_url';
  IF secret_id IS NULL THEN PERFORM vault.create_secret(rtrim(p_project_url,'/'),'tiktok_project_url');
  ELSE PERFORM vault.update_secret(secret_id,rtrim(p_project_url,'/')); END IF;
  SELECT id INTO secret_id FROM vault.secrets WHERE name='tiktok_worker_secret';
  IF secret_id IS NULL THEN PERFORM vault.create_secret(p_worker_secret,'tiktok_worker_secret');
  ELSE PERFORM vault.update_secret(secret_id,p_worker_secret); END IF;
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname='tiktok-publisher'
  LOOP PERFORM cron.unschedule(existing_job); END LOOP;
  PERFORM cron.schedule('tiktok-publisher','* * * * *',$job$ SELECT public.publisher_dispatch('tiktok'); $job$);
END;
$$;
select cron.schedule('instagram-publisher','* * * * *',$job$ select public.publisher_dispatch('instagram'); $job$);
select cron.schedule('instagram-publisher-maintenance','* * * * *',$job$ select public.publisher_dispatch('maintenance'); $job$);
select cron.schedule('x-publisher','* * * * *',$job$ select public.publisher_dispatch('x'); $job$);
select cron.schedule('tiktok-publisher','* * * * *',$job$ select public.publisher_dispatch('tiktok'); $job$);
commit;
