-- Isolated schema for queue tests; no publishing or credentials.
create role anon; create role authenticated; create role service_role;
 create table ig_flows(id uuid primary key,user_id uuid,name text,settings jsonb,state text default 'active',cycle integer default 1,last_error text);
 create table ig_publisher_connections(account_id uuid primary key,user_id uuid,paused boolean default false,reconnect_required boolean default false);
 create table ig_flow_library(id uuid primary key,user_id uuid,url text,retired boolean default false);
 create table ig_publication_jobs(id uuid primary key default gen_random_uuid(),user_id uuid,account_id uuid,caption text,format text,media_urls text[],scheduled_at timestamptz,next_attempt_at timestamptz default now(),flow_id uuid,cover_url text,flow_cycle integer default 1,shared_account_owner uuid,status text default 'scheduled',error_code text,published_at timestamptz,account_owner uuid generated always as (coalesce(shared_account_owner,user_id)) stored,locked_at timestamptz,lock_token uuid,attempts integer default 0,publish_started boolean default false);
 create function ig_flow_destination_ready(uuid,uuid,uuid) returns boolean language sql as $$ select exists(select 1 from public.ig_publisher_connections where account_id=$3) $$;
 create function ig_flow_media_skipped(uuid,uuid,text[]) returns boolean language sql as $$ select false $$;
 create function ig_create_flow(uuid,uuid,text,jsonb,jsonb) returns void language sql as $$ select $$;
 create function ig_claim_job(uuid) returns setof ig_publication_jobs language sql as $$ select * from ig_publication_jobs where false $$;
 create function ig_sync_flow_accounts(uuid,uuid,uuid[],uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
 create function ig_append_flow_cycle(uuid,uuid,integer,jsonb) returns boolean language sql as $$ select false $$;
 create function ig_campaign_progress(uuid,uuid) returns table(account_id uuid,total bigint,last_at timestamptz) language sql as $$ select null::uuid,0::bigint,null::timestamptz where false $$;
 revoke all on function ig_create_flow(uuid,uuid,text,jsonb,jsonb),ig_claim_job(uuid),ig_sync_flow_accounts(uuid,uuid,uuid[],uuid),ig_append_flow_cycle(uuid,uuid,integer,jsonb),ig_campaign_progress(uuid,uuid) from public,anon,authenticated;
 grant execute on function ig_sync_flow_accounts(uuid,uuid,uuid[],uuid),ig_append_flow_cycle(uuid,uuid,integer,jsonb),ig_campaign_progress(uuid,uuid) to service_role;
