-- Preparation only: no cron, OAuth tokens or real publication in this phase.
begin;
create table public.instagram_publication_drafts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 account_id uuid not null,
 caption text not null default '' check (length(caption) <= 2200),
 format text not null check (format in ('Feed','Reel','Story','Carrossel')),
 media_urls text[] not null default '{}',
 scheduled_at timestamptz,
 status text not null default 'draft' check (status in ('draft','waiting_integration','cancelled')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key (account_id,user_id) references public.instagram_accounts(id,user_id) on delete restrict,
 check (cardinality(media_urls) <= case when format = 'Carrossel' then 10 else 1 end),
 check (status <> 'waiting_integration' or (scheduled_at is not null and cardinality(media_urls) >= case when format = 'Carrossel' then 2 else 1 end))
);
alter table public.instagram_publication_drafts enable row level security;
create policy owner_access on public.instagram_publication_drafts for all to authenticated
 using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create index instagram_publication_drafts_owner_idx on public.instagram_publication_drafts(user_id,created_at desc);
create trigger updated_at before update on public.instagram_publication_drafts for each row execute function public.update_updated_at_column();
grant select, insert, update, delete on public.instagram_publication_drafts to authenticated;
comment on table public.instagram_publication_drafts is 'Planning only. waiting_integration MUST require fresh user confirmation before migrating to a live publishing queue.';
commit;
