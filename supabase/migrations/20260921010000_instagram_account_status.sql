-- Atualiza o status das contas Instagram para: em criação, aquecendo, ativa.
begin;
alter table public.instagram_accounts
  drop constraint if exists instagram_accounts_status_check;

update public.instagram_accounts
  set status = 'creating'
  where status = 'paused';

update public.instagram_accounts
  set status = 'warming'
  where status in ('attention', 'problem');

alter table public.instagram_accounts
  add constraint instagram_accounts_status_check
  check (status in ('creating', 'warming', 'active'));
commit;
