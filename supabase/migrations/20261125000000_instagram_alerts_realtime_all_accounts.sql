begin;

-- Upgrade health check claiming to cover up to 200 due accounts per batch,
-- prioritizing never-checked accounts, candidate failures awaiting confirmation,
-- and accounts with reconnect_required / expired OAuth tokens.
create or replace function public.ig_claim_health_checks()
returns setof public.ig_account_health
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.ig_account_health (account_id, user_id)
  select account_id, user_id
    from public.ig_publisher_connections
  on conflict (account_id) do nothing;

  return query
  update public.ig_account_health h
     set next_check_at = now() + interval '5 minutes',
         lease = gen_random_uuid()
   where h.account_id in (
     select q.account_id
       from public.ig_account_health q
       join public.ig_publisher_connections c on c.account_id = q.account_id
      where q.next_check_at <= now()
         or (
           (c.reconnect_required or (c.token_expires_at is not null and c.token_expires_at <= now()))
           and q.state in ('healthy', 'unknown')
           and (q.lease is null or q.next_check_at <= now())
         )
      order by
        (q.checked_at is null or q.state = 'unknown') desc,
        (q.candidate is distinct from q.state) desc,
        q.next_check_at asc
      for update of q skip locked
      limit 200
   )
  returning h.*;
end;
$$;

revoke all on function public.ig_claim_health_checks() from public, anon, authenticated;
grant execute on function public.ig_claim_health_checks() to service_role;

-- Schedule newly connected / reconnected accounts for 1-minute continuous verification.
create or replace function public.ig_connection_health_sync()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not new.reconnect_required and (
    tg_op = 'INSERT' or old.reconnect_required or new.secret_id is distinct from old.secret_id
  ) then
    insert into public.ig_account_health (
      account_id,
      user_id,
      state,
      candidate,
      failures,
      checked_at,
      last_healthy_at,
      error_code,
      next_check_at,
      lease
    )
    values (
      new.account_id,
      new.user_id,
      'healthy',
      'healthy',
      0,
      now() - interval '16 seconds',
      now(),
      null,
      now() + interval '1 minute',
      null
    )
    on conflict (account_id) do update
      set user_id = excluded.user_id,
          state = 'healthy',
          candidate = 'healthy',
          failures = 0,
          checked_at = case
            when public.ig_account_health.checked_at is null
              or public.ig_account_health.state <> 'healthy'
              then now() - interval '16 seconds'
            else public.ig_account_health.checked_at
          end,
          last_healthy_at = now(),
          error_code = null,
          next_check_at = now() + interval '1 minute',
          lease = null
      where public.ig_account_health.state <> 'healthy'
         or public.ig_account_health.failures > 0
         or public.ig_account_health.checked_at is null;
  elsif new.reconnect_required and (tg_op = 'INSERT' or not old.reconnect_required) then
    insert into public.ig_account_health (
      account_id,
      user_id,
      state,
      candidate,
      failures,
      checked_at,
      error_code,
      next_check_at,
      lease
    )
    values (
      new.account_id,
      new.user_id,
      'reconnect',
      'reconnect',
      1,
      now(),
      'meta_190',
      now() + interval '1 minute',
      null
    )
    on conflict (account_id) do update
      set user_id = excluded.user_id,
          state = case
            when public.ig_account_health.state = 'permissions' then 'permissions'
            else 'reconnect'
          end,
          candidate = case
            when public.ig_account_health.state = 'permissions' then 'permissions'
            else 'reconnect'
          end,
          failures = greatest(public.ig_account_health.failures, 1),
          checked_at = now(),
          error_code = coalesce(public.ig_account_health.error_code, 'meta_190'),
          next_check_at = now() + interval '1 minute',
          lease = null
      where public.ig_account_health.state not in ('reconnect', 'permissions');
  end if;

  return new;
end;
$$;

revoke all on function public.ig_connection_health_sync() from public, anon, authenticated;
grant execute on function public.ig_connection_health_sync() to service_role;

-- Ensure every connected account has a health row and schedule an immediate check
-- for any account that is unknown, unchecked, or older than 1 minute.
insert into public.ig_account_health (account_id, user_id)
select c.account_id, c.user_id
  from public.ig_publisher_connections c
on conflict (account_id) do nothing;

update public.ig_account_health
   set next_check_at = now(),
       lease = null
 where checked_at is null
    or state = 'unknown'
    or checked_at < now() - interval '1 minute'
    or next_check_at > now() + interval '1 minute';

commit;
