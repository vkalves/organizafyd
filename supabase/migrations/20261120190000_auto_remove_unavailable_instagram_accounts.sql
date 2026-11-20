begin;

-- Only a confirmed, persistent inaccessible profile can be automatically
-- removed. Expired credentials, revoked permissions and transient Meta errors
-- require attention but must never cause a destructive disconnect.
create table public.ig_auto_removed_accounts (
  account_id uuid primary key references public.instagram_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  graph_id text not null,
  detected_at timestamptz not null default now(),
  error_code text not null,
  checks integer not null
);
alter table public.ig_auto_removed_accounts enable row level security;
revoke all on public.ig_auto_removed_accounts from public, anon, authenticated;
grant select, insert on public.ig_auto_removed_accounts to service_role;

-- The existing disconnect routine is reused to preserve historical posts,
-- remove flow membership and cancel only the failed profile's pending jobs.
-- On a processing lease, leave the profile in place and retry on the next
-- health check; do not abort or mutate the in-flight publication.
create function public.ig_auto_remove_unavailable_account(
  p_user uuid, p_account uuid, p_lease uuid
) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_graph text;
  v_code text;
  v_checks integer;
  v_last_healthy timestamptz;
  v_current_graph text;
begin
  if p_user is null or p_account is null or p_lease is null then
    return false;
  end if;
  select c.graph_id into v_graph from public.ig_publisher_connections c
  where c.account_id=p_account and c.user_id=p_user;
  if not found then return false; end if;

  -- Disconnect uses the same graph lock and then the owner lock. Keep their
  -- ordering to prevent deadlocks with OAuth and flow creation.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_graph,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user::text,0)
  );

  -- The graph lock also serializes a competing OAuth reconnect. Never remove
  -- a replacement connection after an earlier health check.
  select c.graph_id into v_current_graph
  from public.ig_publisher_connections c
  where c.account_id=p_account and c.user_id=p_user;
  if v_current_graph is distinct from v_graph then return false; end if;

  select h.error_code,h.failures,h.last_healthy_at
    into v_code,v_checks,v_last_healthy
  from public.ig_account_health h
  where h.account_id=p_account and h.user_id=p_user
    and h.lease=p_lease and h.state='unavailable'
    and h.candidate='unavailable'
    and h.failures>=3
    and h.error_code in ('meta_100','meta_803')
    and h.checked_at>=now()-interval '10 minutes'
    -- The third consecutive failed check must span 15 minutes without
    -- a valid response: a single short Meta outage cannot remove a profile.
    and h.checked_at - coalesce(h.last_healthy_at,
      h.checked_at-interval '15 minutes')>=interval '15 minutes'
    and (h.last_healthy_at is null
      or h.last_healthy_at<=now()-interval '15 minutes')
  for update;
  if not found then return false; end if;

  -- We must not interfere with any currently processing publication, even
  -- in a shared flow owned by another AVANÇA user.
  if exists (
    select 1 from public.ig_publication_jobs j
    where j.account_id=p_account and j.account_owner=p_user
      and j.status='processing'
  ) then return false; end if;

  -- Existing routine updates the owner's flows and queue. Shared account
  -- references are removed by the FK cascade and its existing trigger.
  perform public.ig_disconnect_account(p_user,p_account);

  -- Preserve a short audit trail separate from the live health row, which
  -- was removed with its connection.
  insert into public.ig_auto_removed_accounts(
    account_id,user_id,graph_id,error_code,checks
  ) values(p_account,p_user,v_graph,v_code,v_checks)
  on conflict(account_id) do update
    set detected_at=now(),error_code=excluded.error_code,
        checks=excluded.checks;
  return true;
exception when raise_exception then
  if sqlerrm='account_busy' then return false; end if;
  raise;
end;
$$;
revoke all on function public.ig_auto_remove_unavailable_account(uuid,uuid,uuid)
from public,anon,authenticated;
grant execute on function public.ig_auto_remove_unavailable_account(uuid,uuid,uuid)
to service_role;
commit;
