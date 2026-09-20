-- Instagram: additive migration; existing modules are unchanged.
begin;
create table public.instagram_projects (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (length(trim(name)) > 0), image_url text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (id, user_id)
);
alter table public.instagram_projects enable row level security;
create index instagram_projects_owner_idx on public.instagram_projects(user_id);
create policy owner_access on public.instagram_projects for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger updated_at before update on public.instagram_projects for each row execute function public.update_updated_at_column();
create table public.instagram_accounts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid, username text not null check (username ~ '^[a-z0-9._]{1,30}$'), name text not null, avatar_url text, category text, status text not null default 'active' check (status in ('active','attention','problem','paused')), niche text, instagram_url text, email text, phone text, responsible text, account_created_on date, notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (id, user_id)
);
alter table public.instagram_accounts enable row level security;
create index instagram_accounts_owner_idx on public.instagram_accounts(user_id);
create policy owner_access on public.instagram_accounts for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger updated_at before update on public.instagram_accounts for each row execute function public.update_updated_at_column();
create table public.instagram_labels (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (length(trim(name)) > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (id, user_id)
);
alter table public.instagram_labels enable row level security;
create index instagram_labels_owner_idx on public.instagram_labels(user_id);
create policy owner_access on public.instagram_labels for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger updated_at before update on public.instagram_labels for each row execute function public.update_updated_at_column();
create table public.instagram_account_labels (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 account_id uuid not null, label_id uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (id, user_id)
);
alter table public.instagram_account_labels enable row level security;
create index instagram_account_labels_owner_idx on public.instagram_account_labels(user_id);
create policy owner_access on public.instagram_account_labels for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger updated_at before update on public.instagram_account_labels for each row execute function public.update_updated_at_column();
create table public.instagram_contents (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 account_id uuid not null, title text not null check (length(trim(title)) > 0), caption text, hashtags text, notes text, media_url text, thumbnail_url text, format text not null default 'Reel' check (format in ('Feed','Reel','Story','Carrossel')), status text not null default 'idea' check (status in ('idea','produce','producing','ready','scheduled','published')), planned_at timestamptz, published_at timestamptz, publication_url text, check (status <> 'published' or published_at is not null), check (status <> 'scheduled' or planned_at is not null),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (id, user_id)
);
alter table public.instagram_contents enable row level security;
create index instagram_contents_owner_idx on public.instagram_contents(user_id);
create policy owner_access on public.instagram_contents for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger updated_at before update on public.instagram_contents for each row execute function public.update_updated_at_column();
create table public.instagram_tasks (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 account_id uuid not null, title text not null check (length(trim(title)) > 0), description text, notes text, due_at timestamptz, priority text not null default 'medium' check (priority in ('low','medium','high')), status text not null default 'todo' check (status in ('todo','doing','done')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (id, user_id)
);
alter table public.instagram_tasks enable row level security;
create index instagram_tasks_owner_idx on public.instagram_tasks(user_id);
create policy owner_access on public.instagram_tasks for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger updated_at before update on public.instagram_tasks for each row execute function public.update_updated_at_column();
create table public.instagram_metrics (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 account_id uuid not null, recorded_on date not null default current_date,followers bigint check (followers >= 0),following bigint check (following >= 0),posts bigint check (posts >= 0),views bigint check (views >= 0),reach bigint check (reach >= 0),likes bigint check (likes >= 0),comments bigint check (comments >= 0),shares bigint check (shares >= 0),saves bigint check (saves >= 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (id, user_id)
);
alter table public.instagram_metrics enable row level security;
create index instagram_metrics_owner_idx on public.instagram_metrics(user_id);
create policy owner_access on public.instagram_metrics for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger updated_at before update on public.instagram_metrics for each row execute function public.update_updated_at_column();
create table public.instagram_history (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 account_id uuid not null, action text not null, details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (id, user_id)
);
alter table public.instagram_history enable row level security;
create index instagram_history_owner_idx on public.instagram_history(user_id);
create policy owner_read on public.instagram_history for select to authenticated using ((select auth.uid()) = user_id);
alter table public.instagram_account_labels add foreign key (account_id, user_id) references public.instagram_accounts(id,user_id) on delete cascade;
create index instagram_account_labels_account_idx on public.instagram_account_labels(account_id);
alter table public.instagram_contents add foreign key (account_id, user_id) references public.instagram_accounts(id,user_id) on delete cascade;
create index instagram_contents_account_idx on public.instagram_contents(account_id);
alter table public.instagram_tasks add foreign key (account_id, user_id) references public.instagram_accounts(id,user_id) on delete cascade;
create index instagram_tasks_account_idx on public.instagram_tasks(account_id);
alter table public.instagram_metrics add foreign key (account_id, user_id) references public.instagram_accounts(id,user_id) on delete cascade;
create index instagram_metrics_account_idx on public.instagram_metrics(account_id);
alter table public.instagram_history add foreign key (account_id, user_id) references public.instagram_accounts(id,user_id) on delete cascade;
create index instagram_history_account_idx on public.instagram_history(account_id);
alter table public.instagram_accounts add foreign key (project_id,user_id) references public.instagram_projects(id,user_id) on delete restrict;
alter table public.instagram_account_labels add foreign key (label_id,user_id) references public.instagram_labels(id,user_id) on delete cascade;
create unique index instagram_username_unique on public.instagram_accounts(user_id,lower(username));
create unique index instagram_project_unique on public.instagram_projects(user_id,lower(name));
create unique index instagram_label_unique on public.instagram_labels(user_id,lower(name));
create unique index instagram_account_label_unique on public.instagram_account_labels(account_id,label_id);
create unique index instagram_metric_day_unique on public.instagram_metrics(account_id,recorded_on);
create index instagram_accounts_project_idx on public.instagram_accounts(project_id);
create index instagram_content_schedule_idx on public.instagram_contents(user_id,planned_at);
create index instagram_task_schedule_idx on public.instagram_tasks(user_id,due_at);
create index instagram_history_time_idx on public.instagram_history(account_id,created_at desc);
-- Unassign accounts transactionally before deleting a project; accounts survive.
create function public.instagram_detach_project() returns trigger language plpgsql set search_path = public as $$
begin
 update public.instagram_accounts set project_id=null where project_id=old.id and user_id=old.user_id;
 return old;
end $$;
create trigger detach_project before delete on public.instagram_projects for each row execute function public.instagram_detach_project();
-- Audit only operational changes: no email, phone, captions or private notes copied.
create function public.instagram_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb; previous jsonb; aid uuid; event text;
begin
 r := case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 previous := case when TG_OP='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
 aid := case when TG_TABLE_NAME='instagram_accounts' then (r->>'id')::uuid else (r->>'account_id')::uuid end;
 if not exists(select 1 from public.instagram_accounts where id=aid) then return null; end if;
 event := TG_TABLE_NAME || ':' || lower(TG_OP);
 insert into public.instagram_history(user_id,account_id,action,details)
 values ((r->>'user_id')::uuid,aid,event,jsonb_build_object('status',r->>'status','previous_status',previous->>'status','title',r->>'title','followers',r->>'followers','previous_followers',previous->>'followers'));
 return null;
end $$;
revoke all on function public.instagram_audit() from public;
create trigger audit after insert or update on public.instagram_accounts for each row execute function public.instagram_audit();
create trigger audit after insert or update or delete on public.instagram_contents for each row execute function public.instagram_audit();
create trigger audit after insert or update or delete on public.instagram_tasks for each row execute function public.instagram_audit();
create trigger audit after insert or update or delete on public.instagram_metrics for each row execute function public.instagram_audit();
create trigger audit after insert or update or delete on public.instagram_account_labels for each row execute function public.instagram_audit();
commit;
