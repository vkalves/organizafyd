begin;
create schema if not exists avanca_storage_private;
revoke all on schema avanca_storage_private from public, anon, authenticated;
grant usage on schema avanca_storage_private to service_role;

create table public.avanca_storage_limits (
 user_id uuid primary key references auth.users(id) on delete cascade,
 limit_bytes bigint not null default 1073741824 check(limit_bytes between 0 and 10737418240000),
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null
);
alter table public.avanca_storage_limits enable row level security;
revoke all on public.avanca_storage_limits from public, anon, authenticated;
grant all on public.avanca_storage_limits to service_role;
create policy storage_limits_server on public.avanca_storage_limits to service_role using(true) with check(true);

-- S3 objects and outstanding upload reservations. Only the trusted gateway writes this ledger.
create table avanca_storage_private.objects (
 user_id uuid not null references auth.users(id) on delete cascade,
 bucket text not null check(bucket in ('media','instagram-publisher','x-media','tiktok-media')),
 path text not null,
 size_bytes bigint not null check(size_bytes >= 0),
 reserved_until timestamptz,
 deleted_at timestamptz,
 primary key(bucket,path),
 check(split_part(path,'/',1)=user_id::text)
);
create index storage_objects_user_idx on avanca_storage_private.objects(user_id);
alter table avanca_storage_private.objects enable row level security;
revoke all on avanca_storage_private.objects from public,anon,authenticated;
grant all on avanca_storage_private.objects to service_role;
create policy storage_objects_server on avanca_storage_private.objects to service_role using(true) with check(true);
-- Use the managed Storage indexes; the application role does not own storage.objects.

create function avanca_storage_private.limit_bytes(p_user uuid) returns bigint
language sql stable security invoker set search_path='' as $$
 select case when exists(select 1 from public.avanca_admins where user_id=p_user) then null
 else coalesce((select limit_bytes from public.avanca_storage_limits where user_id=p_user),1073741824) end;
$$;
create function avanca_storage_private.used_bytes(p_user uuid) returns bigint
language sql stable security invoker set search_path='' as $$
 select coalesce(sum(bytes),0)::bigint from (
  select bucket,path,max(bytes) as bytes from (
   select bucket_id as bucket,name as path,coalesce((metadata->>'size')::bigint,0) as bytes
   from storage.objects where bucket_id in ('media','instagram-publisher','x-media','tiktok-media') and name like p_user::text||'/%'
   union all select bucket,path,size_bytes from avanca_storage_private.objects where user_id=p_user
  ) files group by bucket,path
 ) unique_files;
$$;
create function public.avanca_storage_access(p_user uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('storage_limit_bytes',avanca_storage_private.limit_bytes(p_user),
 'storage_used_bytes',avanca_storage_private.used_bytes(p_user));
$$;
create function public.avanca_admin_update_storage(p_actor uuid,p_target uuid,p_bytes bigint) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.avanca_admins where user_id=p_actor) then raise exception 'forbidden'; end if;
 if p_bytes is null or p_bytes<0 or p_bytes>10737418240000 then raise exception 'invalid_storage_limit'; end if;
 if not exists(select 1 from auth.users where id=p_target) then raise exception 'user_not_found'; end if;
 perform pg_advisory_xact_lock(hashtextextended('avanca-storage:'||p_target::text,0));
 if exists(select 1 from public.avanca_admins where user_id=p_target) then raise exception 'admin_storage_unlimited'; end if;
 insert into public.avanca_storage_limits(user_id,limit_bytes,updated_at,updated_by) values(p_target,p_bytes,now(),p_actor)
 on conflict(user_id) do update set limit_bytes=excluded.limit_bytes,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
end; $$;

-- Imports observed S3 inventory without evicting concurrent reservations. Expired reservations
-- may be dropped only after a complete, successful S3 listing started after their safe deadline.
create function public.avanca_storage_sync(p_user uuid,p_objects jsonb,p_started timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('avanca-storage:'||p_user::text,0));
 if p_objects is null or jsonb_typeof(p_objects)<>'array' or p_started is null or p_started>now() then raise exception 'invalid_inventory'; end if;
 insert into avanca_storage_private.objects(user_id,bucket,path,size_bytes)
 select p_user,x.bucket,x.path,x.size_bytes from jsonb_to_recordset(p_objects) as x(bucket text,path text,size_bytes bigint)
 on conflict(bucket,path) do update set size_bytes=excluded.size_bytes,deleted_at=null
 where avanca_storage_private.objects.deleted_at is null or avanca_storage_private.objects.deleted_at<p_started;
 -- Keep confirmed ledger entries until removal is acknowledged. Only abandoned reservations expire.
 delete from avanca_storage_private.objects o where o.user_id=p_user and o.reserved_until<p_started
 and not exists(select 1 from jsonb_to_recordset(p_objects) as x(bucket text,path text,size_bytes bigint) where x.bucket=o.bucket and x.path=o.path);
end; $$;
create function public.avanca_storage_reserve(p_user uuid,p_bucket text,p_path text,p_size bigint) returns timestamptz
language plpgsql security invoker set search_path='' as $$
declare cap bigint; deadline timestamptz := now()+interval '10 minutes';
begin
 perform pg_advisory_xact_lock(hashtextextended('avanca-storage:'||p_user::text,0));
 if p_size is null or p_size<=0 or p_size>104857600 then raise exception 'invalid_upload'; end if;
 if exists(select 1 from avanca_storage_private.objects where bucket=p_bucket and path=p_path) then raise exception 'upload_pending'; end if;
 cap := avanca_storage_private.limit_bytes(p_user);
 if cap is not null and avanca_storage_private.used_bytes(p_user)+p_size>cap then raise exception 'storage_quota_exceeded'; end if;
 insert into avanca_storage_private.objects(user_id,bucket,path,size_bytes,reserved_until) values(p_user,p_bucket,p_path,p_size,deadline);
 return deadline;
end; $$;
create function public.avanca_storage_removed(p_bucket text,p_paths text[]) returns void
language plpgsql security invoker set search_path='' as $$
declare target uuid;
begin
 for target in select distinct user_id from avanca_storage_private.objects where bucket=p_bucket and path=any(p_paths) order by user_id loop
  perform pg_advisory_xact_lock(hashtextextended('avanca-storage:'||target::text,0));
 end loop;
 -- An unexpired signed POST could recreate the object. Keep its bytes reserved until it expires.
 -- Tombstones stop an older, in-flight inventory from restoring deleted bytes.
 update avanca_storage_private.objects set
 size_bytes=case when reserved_until>now() then size_bytes else 0 end,
 reserved_until=greatest(coalesce(reserved_until,now()),now()+interval '10 minutes'),
 deleted_at=clock_timestamp()
 where bucket=p_bucket and path=any(p_paths);
end; $$;

-- Enforce the same combined quota for the original Supabase upload API, including
-- service uploads on behalf of an owner, upserts and ownership/path changes.
create function avanca_storage_private.enforce_legacy() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid; cap bigint; old_bytes bigint:=0; new_bytes bigint; s3_bytes bigint:=0;
begin
 if tg_op='DELETE' then return old; end if;
 if new.bucket_id not in ('media','instagram-publisher','x-media','tiktok-media') then return new; end if;
 if split_part(new.name,'/',1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid_storage_owner'; end if;
 target:=split_part(new.name,'/',1)::uuid;
 perform pg_advisory_xact_lock(hashtextextended('avanca-storage:'||target::text,0));
 new_bytes:=(new.metadata->>'size')::bigint;
 if new_bytes is null or new_bytes<0 then raise exception 'invalid_upload_size'; end if;
 if tg_op='UPDATE' and old.bucket_id=new.bucket_id and old.name=new.name then old_bytes:=coalesce((old.metadata->>'size')::bigint,0); end if;
 select coalesce(max(size_bytes),0) into s3_bytes from avanca_storage_private.objects where bucket=new.bucket_id and path=new.name;
 -- Metadata updates and reductions remain possible for users already above their cap.
 if greatest(new_bytes,s3_bytes)<=greatest(old_bytes,s3_bytes) then return new; end if;
 cap:=avanca_storage_private.limit_bytes(target);
 if cap is not null and avanca_storage_private.used_bytes(target)>cap then raise exception 'storage_quota_exceeded'; end if;
 return new;
end; $$;
create trigger avanca_storage_quota after insert or update of bucket_id,name,metadata on storage.objects for each row execute function avanca_storage_private.enforce_legacy();

revoke all on all functions in schema avanca_storage_private from public,anon,authenticated;
grant execute on all functions in schema avanca_storage_private to service_role;
revoke all on function public.avanca_storage_access(uuid),public.avanca_admin_update_storage(uuid,uuid,bigint),public.avanca_storage_sync(uuid,jsonb,timestamptz),public.avanca_storage_reserve(uuid,text,text,bigint),public.avanca_storage_removed(text,text[]) from public,anon,authenticated;
grant execute on function public.avanca_storage_access(uuid),public.avanca_admin_update_storage(uuid,uuid,bigint),public.avanca_storage_sync(uuid,jsonb,timestamptz),public.avanca_storage_reserve(uuid,text,text,bigint),public.avanca_storage_removed(text,text[]) to service_role;
create or replace function public.avanca_user_access(p_user uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('is_admin',exists(select 1 from public.avanca_admins where user_id=p_user),
 'connected_accounts',(select count(*) from public.ig_publisher_connections where user_id=p_user),
 'connection_allowed',coalesce((select connection_allowed from public.avanca_user_limits where user_id=p_user),true),
 'max_accounts',case when exists(select 1 from public.avanca_user_limits where user_id=p_user) then (select max_accounts from public.avanca_user_limits where user_id=p_user) else 10 end) || public.avanca_storage_access(p_user);
$$;
create or replace function public.avanca_admin_users(p_actor uuid,p_search text default '',p_page integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.avanca_admins where user_id=p_actor) then raise exception 'forbidden'; end if;
 if p_page<1 or p_page>100000 or length(p_search)>100 then raise exception 'invalid_request'; end if;
 select jsonb_build_object('users',coalesce((select jsonb_agg(x) from(
  select u.id,u.email,coalesce(p.display_name,'') as display_name,u.created_at,
  (select count(*) from public.ig_publisher_connections c where c.user_id=u.id) as connected_accounts,
  coalesce(l.connection_allowed,true) as connection_allowed,case when l.user_id is null then 10 else l.max_accounts end as max_accounts,l.updated_at,
  exists(select 1 from public.avanca_admins a where a.user_id=u.id) as is_admin,
  avanca_storage_private.limit_bytes(u.id) as storage_limit_bytes,
  avanca_storage_private.used_bytes(u.id) as storage_used_bytes
  from auth.users u left join public.profiles p on p.user_id=u.id left join public.avanca_user_limits l on l.user_id=u.id
  where coalesce(u.email,'') ilike '%'||p_search||'%' or coalesce(p.display_name,'') ilike '%'||p_search||'%'
  order by u.created_at desc,u.id limit 50 offset (p_page-1)*50
 ) x),'[]'::jsonb),
 'total',(select count(*) from auth.users u left join public.profiles p on p.user_id=u.id where coalesce(u.email,'') ilike '%'||p_search||'%' or coalesce(p.display_name,'') ilike '%'||p_search||'%'),
 'summary',jsonb_build_object('users',(select count(*) from auth.users),'accounts',(select count(*) from public.ig_publisher_connections),'blocked',(select count(*) from public.avanca_user_limits where not connection_allowed))) into result;
 return result;
end; $$;
commit;
