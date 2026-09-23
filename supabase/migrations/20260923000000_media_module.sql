-- Media module: two cards (referencias | original) + public share link.
-- Additive only. Does not alter existing tables, functions, or policies.

begin;

create table public.media_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card text not null check (card in ('referencias', 'original')),
  name text not null,
  mime_type text not null,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

alter table public.media_items enable row level security;

create index media_items_owner_card_idx on public.media_items (user_id, card, created_at desc);

create policy "Users CRUD own media_items"
  on public.media_items
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table public.media_public_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);

alter table public.media_public_links enable row level security;

create policy "Users CRUD own media_public_links"
  on public.media_public_links
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.get_public_media(p_token text)
returns table (
  id uuid,
  card text,
  name text,
  mime_type text,
  storage_path text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.card, i.name, i.mime_type, i.storage_path, i.created_at
  from public.media_items i
  inner join public.media_public_links l on l.user_id = i.user_id
  where l.token = p_token
  order by i.created_at desc;
$$;

revoke all on function public.get_public_media(text) from public;
grant execute on function public.get_public_media(text) to anon, authenticated;

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

create policy "media_public_read"
  on storage.objects
  for select
  using (bucket_id = 'media');

create policy "media_owner_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "media_owner_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

commit;
