
-- Enable pg_cron and pg_net extensions when supported by the host database
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
EXCEPTION
  WHEN OTHERS THEN NULL;
END
$$;
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
EXCEPTION
  WHEN OTHERS THEN NULL;
END
$$;
