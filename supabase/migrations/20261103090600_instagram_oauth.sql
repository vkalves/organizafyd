alter table public.ig_publisher_connections add column provider text not null default 'facebook' check(provider in ('facebook','instagram'));
alter table public.ig_publisher_connections add column token_expires_at timestamptz;
create table public.ig_connection_invites (
 token_hash text primary key, user_id uuid not null references auth.users(id) on delete cascade,
 manager_label text not null, expires_at timestamptz not null default now()+interval '24 hours'
);
create table public.ig_login_states (
 state_hash text primary key, verifier_hash text not null, user_id uuid not null references auth.users(id) on delete cascade,
 expires_at timestamptz not null default now()+interval '10 minutes'
);
alter table public.ig_connection_invites enable row level security;
alter table public.ig_login_states enable row level security;
revoke all on public.ig_connection_invites,public.ig_login_states from anon,authenticated;
grant all on public.ig_connection_invites,public.ig_login_states to service_role;
create index ig_invites_owner on public.ig_connection_invites(user_id);
create index ig_states_owner on public.ig_login_states(user_id);
create function public.ig_login_config() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_object_agg(name,decrypted_secret) from vault.decrypted_secrets where name in ('instagram_app_id','instagram_app_secret');
$$;
revoke all on function public.ig_login_config() from public,anon,authenticated;
grant execute on function public.ig_login_config() to service_role;
create function public.ig_connect_oauth(p_user uuid,p_graph text,p_username text,p_token text,p_expires timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid; existing_provider text;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_graph,0));
 select provider into existing_provider from public.ig_publisher_connections where graph_id=p_graph;
 -- Never replace a legacy connection with an incompatible provider's credential.
 if existing_provider='facebook' then raise exception 'provider_conflict'; end if;
 a:=public.ig_connect_account(p_user,p_graph,p_username,p_token);
 update public.ig_publisher_connections set provider='instagram',token_expires_at=p_expires where account_id=a;
 return a;
end; $$;
revoke all on function public.ig_connect_oauth(uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.ig_connect_oauth(uuid,text,text,text,timestamptz) to service_role;
