create table public.instagram_ideas (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 account_id uuid not null,
 title text not null check (length(trim(title)) > 0),
 content text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (id, user_id)
);
alter table public.instagram_ideas enable row level security;
create index instagram_ideas_owner_idx on public.instagram_ideas(user_id);
create policy owner_access on public.instagram_ideas for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger updated_at before update on public.instagram_ideas for each row execute function public.update_updated_at_column();
alter table public.instagram_ideas add foreign key (account_id, user_id) references public.instagram_accounts(id,user_id) on delete cascade;
create index instagram_ideas_account_idx on public.instagram_ideas(account_id);
create trigger audit after insert or update or delete on public.instagram_ideas for each row execute function public.instagram_audit();
