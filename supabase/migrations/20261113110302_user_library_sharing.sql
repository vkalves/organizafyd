begin;
-- Access is mediated by the authenticated publisher endpoint. Do not expose a
-- public user directory, email addresses, storage paths or cross-owner writes.
create table public.ig_library_handles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,30}$')
);
create table public.ig_library_shares (
  owner_id uuid not null references public.ig_library_handles(user_id) on delete cascade,
  recipient_id uuid not null references public.ig_library_handles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, recipient_id),
  check (owner_id <> recipient_id)
);
create index ig_library_shares_recipient on public.ig_library_shares(recipient_id);
alter table public.ig_library_handles enable row level security;
alter table public.ig_library_shares enable row level security;
revoke all on public.ig_library_handles, public.ig_library_shares from public, anon, authenticated;
grant all on public.ig_library_handles, public.ig_library_shares to service_role;
commit;
