create table public.ig_account_health (
 account_id uuid primary key references public.ig_publisher_connections(account_id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 state text not null default 'unknown' check(state in ('unknown','healthy','reconnect','permissions','unavailable','temporary')),
 candidate text not null default 'unknown', failures integer not null default 0,
 checked_at timestamptz, last_healthy_at timestamptz, error_code text,
 next_check_at timestamptz not null default now(), lease uuid
);
create index ig_health_due on public.ig_account_health(next_check_at);
create index ig_health_owner on public.ig_account_health(user_id);
create table public.ig_account_alerts (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.ig_publisher_connections(account_id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 state text not null, created_at timestamptz not null default now(), read_at timestamptz, resolved_at timestamptz
);
create index ig_alert_owner on public.ig_account_alerts(user_id,created_at desc);
create unique index ig_alert_active on public.ig_account_alerts(account_id) where resolved_at is null;
alter table public.ig_account_health enable row level security;
alter table public.ig_account_alerts enable row level security;
revoke all on public.ig_account_health, public.ig_account_alerts from public,anon,authenticated;
grant select on public.ig_account_health, public.ig_account_alerts to authenticated;
grant all on public.ig_account_health, public.ig_account_alerts to service_role;
create policy own_health on public.ig_account_health for select to authenticated using((select auth.uid())=user_id);
create policy own_alerts on public.ig_account_alerts for select to authenticated using((select auth.uid())=user_id);
-- Runs as the service caller. User roles cannot mutate health or manufacture alerts.
create function public.ig_health_alert_transition() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.state is distinct from old.state then
  update public.ig_account_alerts set resolved_at=now() where account_id=new.account_id and resolved_at is null;
  if new.state not in ('healthy','unknown') then
   insert into public.ig_account_alerts(account_id,user_id,state) values(new.account_id,new.user_id,new.state);
  end if;
 end if;
 return new;
end; $$;
revoke all on function public.ig_health_alert_transition() from public,anon,authenticated;
grant execute on function public.ig_health_alert_transition() to service_role;
create trigger ig_health_alert after update of state on public.ig_account_health for each row execute function public.ig_health_alert_transition();
create function public.ig_claim_health_checks() returns setof public.ig_account_health language plpgsql security invoker set search_path='' as $$
begin
 insert into public.ig_account_health(account_id,user_id)
 select account_id,user_id from public.ig_publisher_connections on conflict(account_id) do nothing;
 return query update public.ig_account_health h set next_check_at=now()+interval '5 minutes',lease=gen_random_uuid()
 where h.account_id in (select account_id from public.ig_account_health where next_check_at<=now() order by next_check_at for update skip locked limit 20)
 returning h.*;
end; $$;
revoke all on function public.ig_claim_health_checks() from public,anon,authenticated;
grant execute on function public.ig_claim_health_checks() to service_role;
select cron.schedule('instagram-account-monitor','* * * * *',$job$
 select net.http_post(
  url:='https://csaplfphtvufxjhbpstl.supabase.co/functions/v1/instagram-monitor',
  headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='ig_worker_secret')),
  body:='{"action":"worker"}'::jsonb,timeout_milliseconds:=90000
 );
$job$);
