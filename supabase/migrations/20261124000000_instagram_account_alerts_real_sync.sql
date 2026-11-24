begin;

-- Ensure alert transitions fire on both INSERT and UPDATE, self-heal missing
-- active alerts, and keep ig_publisher_connections.reconnect_required synchronized.
create or replace function public.ig_health_alert_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.state in ('healthy', 'unknown') then
    update public.ig_account_alerts
       set resolved_at = now()
     where account_id = new.account_id
       and resolved_at is null;

    if new.state = 'healthy' then
      update public.ig_publisher_connections
         set reconnect_required = false
       where account_id = new.account_id
         and user_id = new.user_id
         and reconnect_required;
    end if;
  else
    update public.ig_account_alerts
       set resolved_at = now()
     where account_id = new.account_id
       and resolved_at is null
       and state is distinct from new.state;

    insert into public.ig_account_alerts (account_id, user_id, state)
    select new.account_id, new.user_id, new.state
     where not exists (
       select 1
         from public.ig_account_alerts a
        where a.account_id = new.account_id
          and a.resolved_at is null
     );

    if new.state in ('reconnect', 'permissions') then
      update public.ig_publisher_connections
         set reconnect_required = true
       where account_id = new.account_id
         and user_id = new.user_id
         and not reconnect_required;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.ig_health_alert_transition() from public, anon, authenticated;
grant execute on function public.ig_health_alert_transition() to service_role;

drop trigger if exists ig_health_alert on public.ig_account_health;
create trigger ig_health_alert
after insert or update of state, checked_at on public.ig_account_health
for each row
execute function public.ig_health_alert_transition();

-- Synchronize newly connected, reconnected, or invalidated connections into ig_account_health.
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
      now() - interval '61 seconds',
      now(),
      null,
      now() + interval '5 minutes',
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
              then now() - interval '61 seconds'
            else public.ig_account_health.checked_at
          end,
          last_healthy_at = now(),
          error_code = null,
          next_check_at = now() + interval '5 minutes',
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
      next_check_at
    )
    values (
      new.account_id,
      new.user_id,
      'reconnect',
      'reconnect',
      1,
      now(),
      'meta_190',
      now() + interval '5 minutes'
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
          error_code = coalesce(public.ig_account_health.error_code, 'meta_190')
      where public.ig_account_health.state not in ('reconnect', 'permissions');
  end if;

  return new;
end;
$$;

revoke all on function public.ig_connection_health_sync() from public, anon, authenticated;
grant execute on function public.ig_connection_health_sync() to service_role;

drop trigger if exists ig_connection_health_sync on public.ig_publisher_connections;
create trigger ig_connection_health_sync
after insert or update of reconnect_required, secret_id on public.ig_publisher_connections
for each row
execute function public.ig_connection_health_sync();

-- Backfill any existing connections and heal any missing or stale alerts.
insert into public.ig_account_health (account_id, user_id, state, candidate, failures, checked_at, last_healthy_at, error_code)
select c.account_id,
       c.user_id,
       case when c.reconnect_required then 'reconnect' else 'unknown' end,
       case when c.reconnect_required then 'reconnect' else 'unknown' end,
       case when c.reconnect_required then 1 else 0 end,
       case when c.reconnect_required then now() else null end,
       null,
       case when c.reconnect_required then 'meta_190' else null end
  from public.ig_publisher_connections c
 on conflict (account_id) do nothing;

update public.ig_account_health h
   set state = 'reconnect',
       candidate = 'reconnect',
       failures = greatest(h.failures, 1),
       checked_at = coalesce(h.checked_at, now()),
       error_code = coalesce(h.error_code, 'meta_190')
  from public.ig_publisher_connections c
 where c.account_id = h.account_id
   and c.reconnect_required
   and h.state in ('healthy', 'unknown');

update public.ig_account_alerts a
   set resolved_at = now()
  from public.ig_account_health h
 where a.account_id = h.account_id
   and a.resolved_at is null
   and h.state in ('healthy', 'unknown');

insert into public.ig_account_alerts (account_id, user_id, state)
select h.account_id, h.user_id, h.state
  from public.ig_account_health h
 where h.state not in ('healthy', 'unknown')
   and not exists (
     select 1
       from public.ig_account_alerts a
      where a.account_id = h.account_id
        and a.resolved_at is null
   );

commit;
