begin;
-- Long-lived polls or large backlogs must not monopolize a partition.
alter table public.x_accounts add column last_worker_at timestamptz;
create or replace function public.x_claim_account(p_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update public.x_accounts set lock_token=p_token,locked_until=now()+interval '3 minutes',last_worker_at=now()
 where id=p_id and (locked_until is null or locked_until<now());
 return found;
end; $$;
create or replace function public.x_due_accounts_partition(p_shard integer,p_shards integer)
returns table(account_id uuid,user_id uuid) language plpgsql security invoker set search_path='' as $$
begin
 if p_shards is null or p_shard is null or p_shards not between 1 and 8 or p_shard not between 0 and p_shards-1 then raise exception 'invalid_worker_partition'; end if;
 return query select a.id,a.user_id from public.x_accounts a
 join public.x_posts p on p.account_id=a.id
 where not a.paused and not a.reconnect_required and (a.locked_until is null or a.locked_until<now())
 and (hashtext(a.id::text)::bigint & 2147483647) % p_shards = p_shard and p.status='scheduled' and p.scheduled_at<=now()
 group by a.id,a.user_id order by a.last_worker_at nulls first,min(p.scheduled_at),a.id limit 120;
end; $$;
alter table public.tiktok_accounts add column last_worker_at timestamptz;
create or replace function public.tiktok_claim_account(p_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update public.tiktok_accounts set lock_token=p_token,locked_until=now()+interval '3 minutes',last_worker_at=now()
 where id=p_id and (locked_until is null or locked_until<now());
 return found;
end; $$;
create or replace function public.tiktok_due_accounts_partition(p_shard integer,p_shards integer)
returns table(account_id uuid,user_id uuid) language plpgsql security invoker set search_path='' as $$
begin
 if p_shards is null or p_shard is null or p_shards not between 1 and 8 or p_shard not between 0 and p_shards-1 then raise exception 'invalid_worker_partition'; end if;
 return query select a.id,a.user_id from public.tiktok_accounts a
 join public.tiktok_posts p on p.account_id=a.id
 where not a.paused and not a.reconnect_required and (a.locked_until is null or a.locked_until<now())
 and (hashtext(a.id::text)::bigint & 2147483647) % p_shards = p_shard and ((p.status='scheduled' and p.scheduled_at<=now()) or p.status='submitted')
 group by a.id,a.user_id order by a.last_worker_at nulls first,min(p.scheduled_at),a.id limit 120;
end; $$;
commit;
