begin;

-- Daily follower snapshots per Instagram account. Meta only exposes the current
-- followers_count, so growth (7/30/90 days) is computed from these snapshots.
create table if not exists public.ig_account_metrics_daily (
  account_id uuid not null references public.ig_publisher_connections(account_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  followers_count integer not null check (followers_count >= 0),
  follows_count integer check (follows_count >= 0),
  media_count integer check (media_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (account_id, day)
);

create index if not exists ig_account_metrics_daily_owner
  on public.ig_account_metrics_daily (user_id, day desc);

alter table public.ig_account_metrics_daily enable row level security;
revoke all on public.ig_account_metrics_daily from public, anon, authenticated;
grant select on public.ig_account_metrics_daily to authenticated;
grant all on public.ig_account_metrics_daily to service_role;

drop policy if exists own_account_metrics_daily on public.ig_account_metrics_daily;
create policy own_account_metrics_daily on public.ig_account_metrics_daily
  for select to authenticated using ((select auth.uid()) = user_id);

commit;
