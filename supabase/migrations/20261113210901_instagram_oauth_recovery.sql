-- Service-only OAuth identity binding and durable, sanitized completion records.
-- No authorization codes or plaintext provider credentials are retained here.
begin;
alter table public.ig_connection_invites
 add column expected_username text check(expected_username is null or expected_username ~ '^[a-z0-9._]{1,30}$'),
 add column expected_graph_id text check(expected_graph_id is null or expected_graph_id ~ '^[0-9]{5,30}$');
alter table public.ig_login_states
 add column expected_username text check(expected_username is null or expected_username ~ '^[a-z0-9._]{1,30}$'),
 add column expected_graph_id text check(expected_graph_id is null or expected_graph_id ~ '^[0-9]{5,30}$'),
 add column operation_status text not null default 'pending' check(operation_status in ('pending','processing','selection_required','completed','restart_required')),
 add column operation_updated_at timestamptz not null default now(),
 add column operation_result jsonb,
 add column selection_hash text unique,
 add column selected_graph_id text;
create index ig_login_states_expiry on public.ig_login_states(expires_at);
-- Preserve existing RLS and service-only access, including newly added columns.
alter table public.ig_connection_invites enable row level security;
alter table public.ig_login_states enable row level security;
revoke all on public.ig_connection_invites,public.ig_login_states from public,anon,authenticated;
grant all on public.ig_connection_invites,public.ig_login_states to service_role;

-- Bounded opportunistic cleanup: expired encrypted grants and capability rows
-- must not accumulate indefinitely when connection attempts continue.
create function public.ig_prune_login_records()
returns void language plpgsql security invoker set search_path='' as $$
begin
 delete from public.ig_login_states where state_hash in
  (select state_hash from public.ig_login_states where expires_at<=now() order by expires_at limit 500);
 delete from public.ig_connection_invites where token_hash in
  (select token_hash from public.ig_connection_invites where expires_at<=now() order by expires_at limit 500);
end; $$;
revoke all on function public.ig_prune_login_records() from public,anon,authenticated;
grant execute on function public.ig_prune_login_records() to service_role;

-- One transaction: a failed state insertion cannot burn the connection link.
create function public.ig_begin_login(p_invite text,p_state text,p_proof text)
returns void language plpgsql security invoker set search_path='' as $$
declare invitation public.ig_connection_invites%rowtype;
begin
 if p_invite is null or p_state is null or p_proof is null or
   p_invite !~ '^[a-f0-9]{64}$' or p_state !~ '^[a-f0-9]{64}$' or p_proof !~ '^[a-f0-9]{64}$'
 then raise exception 'invalid_invite'; end if;
 perform public.ig_prune_login_records();
 delete from public.ig_connection_invites where token_hash=p_invite and expires_at>now() returning * into invitation;
 if not found then raise exception 'invalid_invite'; end if;
 insert into public.ig_login_states(state_hash,verifier_hash,user_id,meta_app_id,expected_username,expected_graph_id)
 values(p_state,p_proof,invitation.user_id,invitation.meta_app_id,invitation.expected_username,invitation.expected_graph_id);
end; $$;
revoke all on function public.ig_begin_login(text,text,text) from public,anon,authenticated;
grant execute on function public.ig_begin_login(text,text,text) to service_role;

-- Saving the connection and marking completion must commit together. If the HTTP
-- response is lost, the same proof can read/replay this already-committed result.
create function public.ig_complete_login(p_state text,p_proof text,p_graph text,p_username text,
 p_token text,p_business text,p_expires timestamptz,p_app_client_id text,p_config_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare operation public.ig_login_states%rowtype; result jsonb;
begin
 select * into operation from public.ig_login_states where state_hash=p_state and verifier_hash=p_proof and expires_at>now() for update;
 if not found then raise exception 'invalid_state'; end if;
 if operation.selected_graph_id is distinct from p_graph then raise exception 'account_mismatch'; end if;
 if operation.operation_status='completed' then return operation.operation_result; end if;
 if operation.operation_status<>'processing' or operation.pending_grant is null then raise exception 'invalid_state'; end if;
 if p_username is null or p_graph is null or p_graph !~ '^[0-9]{5,30}$' or
   (operation.expected_username is not null and lower(p_username)<>operation.expected_username) or
   (operation.expected_graph_id is not null and p_graph<>operation.expected_graph_id)
 then raise exception 'account_mismatch'; end if;
 if public.avanca_account_status(operation.user_id) is distinct from 'approved' then raise exception 'account_not_approved'; end if;
 if operation.meta_app_id is not null then
  perform public.ig_connect_meta_app(operation.user_id,operation.meta_app_id,p_graph,p_username,p_token,p_business,p_expires,p_app_client_id,p_config_id);
 else
  perform public.ig_connect_unified(operation.user_id,p_graph,p_username,p_token,p_business,p_expires);
 end if;
 result:=jsonb_build_object('username',p_username);
 update public.ig_login_states set operation_status='completed',operation_result=result,
  operation_updated_at=now(),pending_grant=null where state_hash=p_state;
 return result;
end; $$;
revoke all on function public.ig_complete_login(text,text,text,text,text,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.ig_complete_login(text,text,text,text,text,text,timestamptz,text,text) to service_role;
commit;
