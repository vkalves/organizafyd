-- Transactional integration test: synthetic users/apps/accounts are always rolled back.
begin;
do $$
declare u uuid:=gen_random_uuid(); v uuid:=gen_random_uuid(); a uuid; result jsonb; secret text:=repeat('a',32);
begin
 insert into auth.users(id,email) values(u,'meta-test-'||u||'@example.invalid'),(v,'meta-test-'||v||'@example.invalid');
 result:=public.ig_meta_apps_manage(u,'save',jsonb_build_object('name','Test Instagram','appId','123456789','appSecret',secret));
 a:=(result->0->>'id')::uuid;
 assert result->0->>'configId'='';
 assert not (result->0 ? 'secret');
 assert position(secret in result::text)=0;
 assert public.ig_meta_apps_manage(v,'list')='[]'::jsonb;
 assert public.ig_meta_app_config(v,a) is null;
 begin
  perform public.ig_meta_apps_manage(v,'toggle',jsonb_build_object('id',a));
  raise exception 'expected cross-user denial';
 exception when raise_exception then
  if sqlerrm<>'app_not_found' then raise; end if;
 end;
 perform public.ig_meta_apps_manage(u,'save',jsonb_build_object('id',a,'name','Renamed','appId','123456789','appSecret',''));
 assert public.ig_meta_app_config(u,a)->>'secret'=secret;
 perform public.ig_connect_meta_app(u,a,'123456789987654','meta_test','synthetic-token',null,now()+interval '60 days','123456789',null);
 assert exists(select 1 from public.ig_publisher_connections where user_id=u and meta_app_id=a and provider='instagram');
 result:=public.ig_meta_apps_manage(u,'list');
 assert (result->0->>'accountCount')::int=1;
 begin
  perform public.ig_meta_apps_manage(u,'delete',jsonb_build_object('id',a));
  raise exception 'expected linked-app deletion denial';
 exception when raise_exception then
  if sqlerrm<>'app_in_use' then raise; end if;
 end;
 begin
  perform public.ig_connect_meta_app(u,a,'123456789987654','meta_test','synthetic-token',null,null,'987654321',null);
  raise exception 'expected changed-app denial';
 exception when raise_exception then
  if sqlerrm<>'invalid_state' then raise; end if;
 end;
 assert not has_function_privilege('anon','public.ig_meta_apps_manage(uuid,text,jsonb)','execute');
 assert not has_function_privilege('authenticated','public.ig_meta_apps_manage(uuid,text,jsonb)','execute');
 assert not has_function_privilege('authenticated','public.ig_meta_app_config(uuid,uuid)','execute');
 assert not has_table_privilege('authenticated','public.ig_meta_apps','select');
 assert has_function_privilege('service_role','public.ig_meta_apps_manage(uuid,text,jsonb)','execute');
end $$;
rollback;
select 'PASS: private apps, real Vault, secret preservation, account binding, app mutation guard and RPC permissions; fixtures rolled back' as result;
