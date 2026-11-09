-- Run only in an isolated test database after the migration.
-- Creates synthetic fixtures and rolls everything back; never run fixtures in production.
begin;
do $$
declare
  owner_id uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid();
  first_id uuid; second_id uuid; reconnected uuid; token_id uuid;
  multi_flow uuid:=gen_random_uuid(); single_flow uuid:=gen_random_uuid();
  history_job uuid:=gen_random_uuid(); queued_job uuid:=gen_random_uuid();
  other_job uuid:=gen_random_uuid(); processing_job uuid:=gen_random_uuid();
  graph_a text:='99'||translate(substr(replace(gen_random_uuid()::text,'-',''),1,16),'abcdef','123456');
  graph_b text:='98'||translate(substr(replace(gen_random_uuid()::text,'-',''),1,16),'abcdef','123456');
  user_a text:='test_a_'||substr(owner_id::text,1,8);
  user_b text:='test_b_'||substr(owner_id::text,1,8);
begin
  -- Graph IDs must be numeric; these are placeholders, never sent to Meta.
  insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values
    (owner_id,owner_id::text||'@example.invalid','{"display_name":"Account feature test"}','{}'),
    (other_owner,other_owner::text||'@example.invalid','{"display_name":"Other test owner"}','{}');
  execute 'set local role service_role';
  first_id:=public.ig_connect_account(owner_id,graph_a,user_a,'synthetic-test-token');
  second_id:=public.ig_connect_account(owner_id,graph_b,user_b,'synthetic-test-token');
  select secret_id into token_id from public.ig_publisher_connections where account_id=first_id;
  insert into public.ig_flows(id,user_id,name,settings,state) values
    (multi_flow,owner_id,'Synthetic multi-account flow',jsonb_build_object('accountIds',jsonb_build_array(first_id,second_id),'gapMinutes',3,'repeat','loop'),'active'),
    (single_flow,owner_id,'Synthetic single-account flow',jsonb_build_object('accountIds',jsonb_build_array(first_id),'gapMinutes',3,'repeat','loop'),'active');
  insert into public.ig_publication_jobs(id,user_id,account_id,caption,format,media_urls,scheduled_at,status,flow_id) values
    (history_job,owner_id,first_id,'Test','Story',array['https://example.invalid/test.jpg'],now()+interval '1 hour','published',null),
    (queued_job,owner_id,first_id,'Test','Story',array['https://example.invalid/test.jpg'],now()+interval '1 hour','scheduled',multi_flow),
    (gen_random_uuid(),owner_id,first_id,'Test','Story',array['https://example.invalid/test.jpg'],now()+interval '1 hour','scheduled',single_flow),
    (other_job,owner_id,second_id,'Test','Story',array['https://example.invalid/test.jpg'],now()+interval '1 hour','scheduled',multi_flow),
    (processing_job,owner_id,second_id,'Test','Story',array['https://example.invalid/test.jpg'],now()+interval '1 hour','processing',null);
  begin
    perform public.ig_disconnect_account(other_owner,first_id);
    raise exception 'test_failed_wrong_owner_accepted';
  exception when others then if sqlerrm<>'account_not_found' then raise; end if; end;
  begin
    perform public.ig_disconnect_account(owner_id,second_id);
    raise exception 'test_failed_processing_accepted';
  exception when others then if sqlerrm<>'account_busy' then raise; end if; end;
  if not exists(select 1 from public.ig_publisher_connections where account_id=second_id) then raise exception 'test_failed_processing_changed_connection'; end if;
  perform public.ig_disconnect_account(owner_id,first_id);
  if exists(select 1 from public.ig_publisher_connections where account_id=first_id) then raise exception 'test_failed_connection_retained'; end if;
  if exists(select 1 from vault.secrets where id=token_id) then raise exception 'test_failed_token_retained'; end if;
  if not exists(select 1 from public.instagram_accounts where id=first_id) then raise exception 'test_failed_history_account_deleted'; end if;
  if not exists(select 1 from public.ig_publication_jobs where id=history_job and status='published') then raise exception 'test_failed_history_changed'; end if;
  if not exists(select 1 from public.ig_publication_jobs where id=queued_job and status='cancelled') then raise exception 'test_failed_queue_not_cancelled'; end if;
  if not exists(select 1 from public.ig_publication_jobs where id=other_job and status='scheduled') then raise exception 'test_failed_other_queue_changed'; end if;
  if (select settings->'accountIds' from public.ig_flows where id=multi_flow)<>jsonb_build_array(second_id) then raise exception 'test_failed_multi_flow'; end if;
  if (select state from public.ig_flows where id=single_flow)<>'stopped' then raise exception 'test_failed_empty_flow'; end if;
  perform public.ig_disconnect_account(owner_id,first_id); -- Safe retry.
  begin
    insert into public.ig_publication_jobs(id,user_id,account_id,caption,format,media_urls,scheduled_at) values(gen_random_uuid(),owner_id,first_id,'Test','Story',array['https://example.invalid/test.jpg'],now()+interval '1 hour');
    raise exception 'test_failed_removed_account_can_schedule';
  exception when others then if sqlerrm<>'account_not_connected' then raise; end if; end;
  reconnected:=public.ig_connect_account(owner_id,graph_a,user_a,'replacement-synthetic-token');
  if reconnected<>first_id then raise exception 'test_failed_reconnection_lost_identity'; end if;
  if exists(select 1 from public.ig_disconnected_accounts where account_id=first_id) then raise exception 'test_failed_tombstone_retained'; end if;
  execute 'reset role';
end; $$;
select 'all disconnect lifecycle checks passed; fixtures rolled back' as result,
  not has_function_privilege('authenticated','public.ig_disconnect_account(uuid,uuid)','execute') as authenticated_cannot_invoke,
  not has_function_privilege('anon','public.ig_disconnect_account(uuid,uuid)','execute') as anon_cannot_invoke,
  (select relrowsecurity from pg_class where oid='public.ig_disconnected_accounts'::regclass) as tombstones_have_rls;
rollback;
