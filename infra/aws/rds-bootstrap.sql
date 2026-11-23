-- =============================================================================
-- AWS RDS / Aurora PostgreSQL Bootstrap Schema for Avança (organizafyd)
-- =============================================================================
-- Prepares a standard AWS RDS or Aurora PostgreSQL instance to run all
-- application migrations without Supabase platform dependencies.
-- Auth is backed by AWS Cognito (synced to auth.users), Storage by AWS S3,
-- Scheduled Jobs by Amazon EventBridge, and Functions by AWS Lambda.
-- =============================================================================

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION
  WHEN OTHERS THEN NULL;
END
$$;

-- 1. Database roles used by Row-Level Security (RLS) and SECURITY DEFINER RPCs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- 2. Auth schema (AWS Cognito identity mapping + JWT session helpers)
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  cognito_sub TEXT UNIQUE,
  email_confirmed_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    current_user
  );
$$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
    jsonb_build_object(
      'sub', NULLIF(current_setting('request.jwt.claim.sub', true), ''),
      'role', auth.role(),
      'email', NULLIF(current_setting('request.jwt.claim.email', true), '')
    )
  );
$$;

-- Upserts an AWS Cognito user into auth.users, preserving existing UUIDs
CREATE OR REPLACE FUNCTION auth.sync_cognito_user(
  p_id UUID,
  p_email TEXT,
  p_display_name TEXT DEFAULT NULL,
  p_cognito_sub TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE id = p_id
     OR (p_cognito_sub IS NOT NULL AND cognito_sub = p_cognito_sub)
     OR (p_email IS NOT NULL AND lower(email) = lower(p_email))
  ORDER BY (id = p_id) DESC
  LIMIT 1;

  IF v_user_id IS NULL THEN
    v_user_id := COALESCE(p_id, gen_random_uuid());
    INSERT INTO auth.users (id, email, raw_user_meta_data, cognito_sub, email_confirmed_at)
    VALUES (
      v_user_id,
      lower(trim(p_email)),
      CASE
        WHEN p_display_name IS NOT NULL AND length(trim(p_display_name)) > 0
          THEN jsonb_build_object('display_name', trim(p_display_name))
        ELSE '{}'::jsonb
      END,
      p_cognito_sub,
      now()
    );
  ELSE
    UPDATE auth.users
    SET email = COALESCE(lower(trim(p_email)), email),
        cognito_sub = COALESCE(p_cognito_sub, cognito_sub),
        raw_user_meta_data = CASE
          WHEN p_display_name IS NOT NULL AND length(trim(p_display_name)) > 0
            THEN raw_user_meta_data || jsonb_build_object('display_name', trim(p_display_name))
          ELSE raw_user_meta_data
        END,
        updated_at = now()
    WHERE id = v_user_id;
  END IF;

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION auth.sync_cognito_user(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.sync_cognito_user(UUID, TEXT, TEXT, TEXT) TO service_role;

-- 3. Vault schema (RDS encrypted secrets store compatible with existing RPCs)
CREATE SCHEMA IF NOT EXISTS vault;
REVOKE ALL ON SCHEMA vault FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA vault TO service_role;

CREATE TABLE IF NOT EXISTS vault.secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE vault.secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE vault.secrets TO service_role;

CREATE OR REPLACE VIEW vault.decrypted_secrets AS
SELECT
  id,
  name,
  description,
  secret,
  secret AS decrypted_secret,
  created_at,
  updated_at
FROM vault.secrets;

REVOKE ALL ON vault.decrypted_secrets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON vault.decrypted_secrets TO service_role;

CREATE OR REPLACE FUNCTION vault.create_secret(
  new_secret TEXT,
  new_name TEXT DEFAULT NULL,
  new_description TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO vault.secrets (secret, name, description)
  VALUES (new_secret, new_name, COALESCE(new_description, ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION vault.update_secret(
  secret_id UUID,
  new_secret TEXT DEFAULT NULL,
  new_name TEXT DEFAULT NULL,
  new_description TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE vault.secrets
  SET secret = COALESCE(new_secret, secret),
      name = COALESCE(new_name, name),
      description = COALESCE(new_description, description),
      updated_at = now()
  WHERE id = secret_id;
END;
$$;

REVOKE ALL ON FUNCTION vault.create_secret(TEXT, TEXT, TEXT), vault.update_secret(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vault.create_secret(TEXT, TEXT, TEXT), vault.update_secret(UUID, TEXT, TEXT, TEXT) TO service_role;

-- 4. Storage schema (metadata compatibility for S3 quota ledger & bucket policies)
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public BOOLEAN NOT NULL DEFAULT false,
  file_size_limit BIGINT,
  allowed_mime_types TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT REFERENCES storage.buckets(id) ON DELETE CASCADE,
  name TEXT,
  owner UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bucket_id, name)
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE storage.buckets, storage.objects TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT string_to_array(trim(both '/' from COALESCE(name, '')), '/');
$$;

-- 5. Cron and Net schemas (compatibility layer; EventBridge triggers Lambdas in AWS)
CREATE SCHEMA IF NOT EXISTS cron;
CREATE SCHEMA IF NOT EXISTS net;
GRANT USAGE ON SCHEMA cron, net TO service_role;

CREATE TABLE IF NOT EXISTS cron.job (
  jobid BIGSERIAL PRIMARY KEY,
  schedule TEXT NOT NULL,
  command TEXT NOT NULL,
  nodename TEXT NOT NULL DEFAULT 'localhost',
  nodeport INTEGER NOT NULL DEFAULT 5432,
  database TEXT NOT NULL DEFAULT current_database(),
  username TEXT NOT NULL DEFAULT current_user,
  active BOOLEAN NOT NULL DEFAULT true,
  jobname TEXT UNIQUE
);

CREATE OR REPLACE FUNCTION cron.schedule(
  p_jobname TEXT,
  p_schedule TEXT,
  p_command TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO cron.job (jobname, schedule, command)
  VALUES (p_jobname, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE
    SET schedule = EXCLUDED.schedule,
        command = EXCLUDED.command,
        active = true
  RETURNING jobid INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION cron.unschedule(p_jobid BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM cron.job WHERE jobid = p_jobid;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION cron.unschedule(p_jobname TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = p_jobname;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION net.http_post(
  url TEXT,
  body JSONB DEFAULT '{}'::jsonb,
  params JSONB DEFAULT '{}'::jsonb,
  headers JSONB DEFAULT '{}'::jsonb,
  timeout_milliseconds INTEGER DEFAULT 5000
)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 1::bigint;
$$;
