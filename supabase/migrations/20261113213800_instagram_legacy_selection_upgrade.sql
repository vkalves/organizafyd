-- Preserve in-flight account choices created by the pre-recovery OAuth handler.
-- The old and new grants are ciphertext; the browser proof and existing identity
-- remain bound to the same owner/expiry. No credential is returned to clients.
begin;
create function public.ig_upgrade_legacy_selection(
 p_state text,p_proof text,p_previous_grant text,p_pending_grant text,p_app uuid,p_result jsonb)
returns setof public.ig_login_states
language plpgsql security invoker set search_path='' as $$
declare clean_result jsonb;
begin
 if p_state is null or p_state !~ '^[a-f0-9]{64}$' or
    p_proof is null or p_proof !~ '^[a-f0-9]{64}$' or
    p_previous_grant is null or p_pending_grant is null or
    pg_catalog.octet_length(p_pending_grant) not between 57 and 262169 or
    p_pending_grant !~ '^[a-f0-9]{24}\.([a-f0-9]{2})+$' or
    pg_catalog.jsonb_typeof(p_result) is distinct from 'object' or
    pg_catalog.jsonb_typeof(p_result->'selection') is distinct from 'string' or
    (p_result->>'selection') !~ '^[a-f0-9]{64}$' or
    pg_catalog.jsonb_typeof(p_result->'accounts') is distinct from 'array'
 then raise exception 'invalid_selection'; end if;
 -- sha256 is built into PostgreSQL; this does not require an extension or secret.
 if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('selection:'||(p_result->>'selection'),'UTF8')),'hex')<>p_state
 then raise exception 'invalid_selection'; end if;
 if pg_catalog.jsonb_array_length(p_result->'accounts') not between 1 and 500
 then raise exception 'invalid_selection'; end if;
 if exists(select 1 from pg_catalog.jsonb_array_elements(p_result->'accounts') a(value)
   where pg_catalog.jsonb_typeof(a.value) is distinct from 'object' or
     pg_catalog.jsonb_typeof(a.value->'id') is distinct from 'string' or
     (a.value->>'id') !~ '^[0-9]{5,30}$' or
     pg_catalog.jsonb_typeof(a.value->'username') is distinct from 'string' or
     (a.value->>'username') !~ '^[a-zA-Z0-9._]{1,30}$')
 then raise exception 'invalid_selection'; end if;
 -- Explicit allowlist: accidental extra keys, including token fields, are dropped.
 select pg_catalog.jsonb_build_object('selection',p_result->>'selection','accounts',
   pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',a.value->>'id','username',a.value->>'username')))
 into clean_result from pg_catalog.jsonb_array_elements(p_result->'accounts') a(value);
 return query update public.ig_login_states set
   pending_grant=p_pending_grant,meta_app_id=p_app,operation_status='selection_required',
   operation_updated_at=now(),operation_result=clean_result,selection_hash=p_state,selected_graph_id=null
 where state_hash=p_state and verifier_hash=p_proof and pending_grant=p_previous_grant
   and operation_status='pending' and selection_hash is null and expires_at>now()
   and (meta_app_id is null or meta_app_id is not distinct from p_app)
 returning *;
end; $$;
revoke all on function public.ig_upgrade_legacy_selection(text,text,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ig_upgrade_legacy_selection(text,text,text,text,uuid,jsonb) to service_role;
commit;
