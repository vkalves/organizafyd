-- Self-contained fixtures. Every write is rolled back; no Meta calls or Storage deletion.
begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); s uuid; j uuid:=gen_random_uuid(); jobs jsonb; url text;
begin
 insert into auth.users(id,email) values(u,'flow-test-'||u::text||'@example.invalid');
 insert into public.instagram_accounts(id,user_id,username,name) values(a,u,'flow_test','Flow test');
 s:=vault.create_secret('TEST-ONLY-NOT-A-REAL-TOKEN');
 insert into public.ig_publisher_connections(account_id,user_id,graph_id,secret_id) values(a,u,('9'||floor(random()*1e14)::bigint::text),s);
 url:='storage://'||u::text||'/test.jpg';
 insert into public.ig_flow_library(id,user_id,url,kind) values(m,u,url,'posts');
 jobs:=jsonb_build_array(jsonb_build_object('id',j,'account_id',a,'caption','Test','format','Feed','media_urls',jsonb_build_array(url),'scheduled_at',now()+interval '1 day'));
 perform public.ig_create_flow(u,f,'Test','{}',jobs);
 perform public.ig_create_flow(u,f,'Test','{}',jobs);
 if (select count(*) from public.ig_publication_jobs where flow_id=f)<>1 then raise exception 'idempotency failed'; end if;
 begin
  perform public.ig_create_flow(u,f,'Changed','{"changed":true}',jobs);
  raise exception 'missing duplicate rejection';
 exception when others then if sqlerrm<>'duplicate_conflict' then raise; end if; end;
 perform public.ig_retire_flow_media();
 if (select retired from public.ig_flow_library where id=m) then raise exception 'retired pending media'; end if;
 update public.ig_publication_jobs set status='failed' where id=j;
 perform public.ig_retire_flow_media();
 if (select retired from public.ig_flow_library where id=m) then raise exception 'retired failed media'; end if;
 update public.ig_publication_jobs set status='uncertain' where id=j;
 perform public.ig_retire_flow_media();
 if (select retired from public.ig_flow_library where id=m) then raise exception 'retired uncertain media'; end if;
 update public.ig_publication_jobs set status='published',published_at=now() where id=j;
 perform public.ig_retire_flow_media();
 if not (select retired from public.ig_flow_library where id=m) then raise exception 'did not retire completed media'; end if;
 -- The media is now unavailable to a fresh flow, even if a browser retained its ID.
 begin
  perform public.ig_create_flow(u,gen_random_uuid(),'Stale','{}',jobs);
  raise exception 'accepted stale media';
 exception when others then if sqlerrm<>'invalid_media_owner' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
end $$;
set local role authenticated;
do $$ begin
 if exists(select 1 from public.ig_flows) or exists(select 1 from public.ig_flow_library) or exists(select 1 from public.ig_flow_preferences) then raise exception 'RLS leaked another owner'; end if;
 if has_function_privilege('authenticated','public.ig_create_flow(uuid,uuid,text,jsonb,jsonb)','execute') then raise exception 'privileged RPC exposed'; end if;
end $$;
reset role;
rollback;
select 'flow_atomicity_idempotency_retention_rls_passed' as result;
