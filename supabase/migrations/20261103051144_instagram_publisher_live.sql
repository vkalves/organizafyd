begin;
create table public.ig_publisher_connections (
 account_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 graph_id text not null unique check (graph_id ~ '^[0-9]+$'),
 secret_id uuid not null references vault.secrets(id),
 paused boolean not null default false,
 reconnect_required boolean not null default false,
 foreign key (account_id,user_id) references public.instagram_accounts(id,user_id) on delete cascade
);
alter table public.ig_publisher_connections enable row level security;
revoke all on public.ig_publisher_connections from anon, authenticated;
grant all on public.ig_publisher_connections to service_role;
create index ig_connections_owner on public.ig_publisher_connections(user_id);
create table public.ig_publication_jobs (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 account_id uuid not null, caption text not null check(length(caption)<=2200),
 format text not null check(format in ('Feed','Reel','Story','Carrossel')),
 media_urls text[] not null check(cardinality(media_urls) between 1 and 10),
 scheduled_at timestamptz not null,
 status text not null default 'scheduled' check(status in ('scheduled','processing','published','failed','uncertain','cancelled')),
 container_id text, publish_started boolean not null default false,
 media_id text, error_code text, published_at timestamptz,
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 lock_token uuid, locked_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key(account_id,user_id) references public.instagram_accounts(id,user_id) on delete restrict
);
alter table public.ig_publication_jobs enable row level security;
revoke all on public.ig_publication_jobs from anon, authenticated;
grant select on public.ig_publication_jobs to authenticated;
grant all on public.ig_publication_jobs to service_role;
create policy owner_read on public.ig_publication_jobs for select to authenticated using((select auth.uid())=user_id);
create index ig_jobs_owner on public.ig_publication_jobs(user_id,created_at desc);
create index ig_jobs_due on public.ig_publication_jobs(next_attempt_at,scheduled_at) where status='scheduled';
create index ig_jobs_account on public.ig_publication_jobs(account_id);
-- All privileged functions are restricted to the server's service role.
create function public.ig_vault_read(p_id uuid) returns text language sql security definer set search_path='' as $$
 select decrypted_secret from vault.decrypted_secrets where id=p_id;
$$;
revoke all on function public.ig_vault_read(uuid) from public,anon,authenticated;
grant execute on function public.ig_vault_read(uuid) to service_role;
create function public.ig_worker_key() returns text language sql security definer set search_path='' as $$
 select decrypted_secret from vault.decrypted_secrets where name='ig_worker_secret';
$$;
revoke all on function public.ig_worker_key() from public,anon,authenticated;
grant execute on function public.ig_worker_key() to service_role;
create function public.ig_claim_job(p_token uuid) returns setof public.ig_publication_jobs language plpgsql security definer set search_path='' as $$
begin
 -- Never retry a publication whose outcome was not recorded.
 update public.ig_publication_jobs set status='uncertain',error_code='worker_interrupted' where status='processing' and locked_at < now()-interval '10 minutes';
 return query update public.ig_publication_jobs j set status='processing',lock_token=p_token,locked_at=now(),attempts=j.attempts+1
 where j.id=(select q.id from public.ig_publication_jobs q join public.ig_publisher_connections c on c.account_id=q.account_id
 where q.status='scheduled' and q.scheduled_at<=now() and q.next_attempt_at<=now() and not c.paused and not c.reconnect_required
 order by q.scheduled_at for update of q skip locked limit 1) returning j.*;
end; $$;
revoke all on function public.ig_claim_job(uuid) from public,anon,authenticated;
grant execute on function public.ig_claim_job(uuid) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('instagram-publisher','instagram-publisher',false,104857600,array['image/jpeg','video/mp4']) on conflict(id) do nothing;
create policy ig_upload on storage.objects for insert to authenticated with check(bucket_id='instagram-publisher' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy ig_media_read on storage.objects for select to authenticated using(bucket_id='instagram-publisher' and (storage.foldername(name))[1]=(select auth.uid())::text);
-- Secrets are generated inside the database, never committed to source.
do $$ begin
 if not exists(select 1 from vault.secrets where name='ig_worker_secret') then
 perform vault.create_secret(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'ig_worker_secret');
 end if;
end $$;
select cron.schedule('instagram-publisher','* * * * *',$job$
 select net.http_post(
 url:='https://csaplfphtvufxjhbpstl.supabase.co/functions/v1/instagram-publisher',
 headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='ig_worker_secret')),
 body:='{"action":"worker"}'::jsonb, timeout_milliseconds:=90000
 );
$job$);
commit;
