-- Credentials and queue are server-only. The browser uses authenticated Edge actions.
CREATE TABLE public.x_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  x_user_id text NOT NULL,
  username text NOT NULL,
  name text NOT NULL,
  credentials text NOT NULL,
  expires_at timestamptz NOT NULL,
  reconnect_required boolean NOT NULL DEFAULT false,
  paused boolean NOT NULL DEFAULT false,
  lock_token uuid,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, x_user_id), UNIQUE(id, user_id)
);
CREATE TABLE public.x_oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE public.x_posts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  text text NOT NULL DEFAULT '',
  media jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(media) = 'array'),
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','processing','published','failed','uncertain','cancelled')),
  x_post_id text,
  error_code text,
  started_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(account_id,user_id) REFERENCES public.x_accounts(id,user_id) ON DELETE CASCADE
);
CREATE INDEX x_posts_due ON public.x_posts(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX x_posts_owner ON public.x_posts(user_id,created_at DESC);
ALTER TABLE public.x_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.x_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.x_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.x_accounts, public.x_oauth_states, public.x_posts FROM anon, authenticated;
GRANT ALL ON public.x_accounts, public.x_oauth_states, public.x_posts TO service_role;

CREATE FUNCTION public.x_claim_account(p_id uuid, p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.x_accounts SET lock_token=p_token, locked_until=now()+interval '3 minutes'
    WHERE id=p_id AND (locked_until IS NULL OR locked_until < now());
  RETURN FOUND;
END;
$$;
CREATE FUNCTION public.x_release_account(p_id uuid, p_token uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.x_accounts SET lock_token=NULL, locked_until=NULL WHERE id=p_id AND lock_token=p_token;
$$;
REVOKE ALL ON FUNCTION public.x_claim_account(uuid,uuid), public.x_release_account(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.x_claim_account(uuid,uuid), public.x_release_account(uuid,uuid) TO service_role;

CREATE FUNCTION public.x_due_accounts() RETURNS TABLE(account_id uuid, user_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id, a.user_id FROM public.x_accounts a
    JOIN public.x_posts p ON p.account_id=a.id
    WHERE NOT a.paused AND NOT a.reconnect_required
      AND p.status='scheduled' AND p.scheduled_at<=now()
    GROUP BY a.id, a.user_id ORDER BY min(p.scheduled_at), a.id LIMIT 50;
$$;
REVOKE ALL ON FUNCTION public.x_due_accounts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.x_due_accounts() TO service_role;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('x-media','x-media',false,20971520,ARRAY['image/jpeg','image/png','video/mp4'])
ON CONFLICT(id) DO NOTHING;
CREATE POLICY x_media_read ON storage.objects FOR SELECT TO authenticated
  USING(bucket_id='x-media' AND (storage.foldername(name))[1]=auth.uid()::text);
CREATE POLICY x_media_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK(bucket_id='x-media' AND (storage.foldername(name))[1]=auth.uid()::text);
-- Uploaded paths are immutable. Removing media referenced by queued posts requires a server-side cleanup.

CREATE FUNCTION public.configure_x_worker(p_project_url text, p_worker_secret text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE secret_id uuid; existing_job bigint;
BEGIN
  IF p_project_url IS NULL OR p_project_url !~ '^https://[a-z0-9]+\.supabase\.co/?$' THEN
    RAISE EXCEPTION 'Expected Supabase HTTPS URL';
  END IF;
  IF p_worker_secret IS NULL OR length(p_worker_secret)<32 OR p_worker_secret ~ '\s' THEN
    RAISE EXCEPTION 'Worker secret must have at least 32 characters';
  END IF;
  SELECT id INTO secret_id FROM vault.secrets WHERE name='x_project_url';
  IF secret_id IS NULL THEN PERFORM vault.create_secret(rtrim(p_project_url,'/'),'x_project_url');
  ELSE PERFORM vault.update_secret(secret_id,rtrim(p_project_url,'/')); END IF;
  SELECT id INTO secret_id FROM vault.secrets WHERE name='x_worker_secret';
  IF secret_id IS NULL THEN PERFORM vault.create_secret(p_worker_secret,'x_worker_secret');
  ELSE PERFORM vault.update_secret(secret_id,p_worker_secret); END IF;
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname='x-publisher'
  LOOP PERFORM cron.unschedule(existing_job); END LOOP;
  PERFORM cron.schedule('x-publisher','* * * * *',$job$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='x_project_url') || '/functions/v1/x-publisher',
      headers := jsonb_build_object('Content-Type','application/json','X-Worker-Secret',
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='x_worker_secret')),
      body := '{"action":"process"}'::jsonb, timeout_milliseconds := 120000
    );
    DELETE FROM public.x_oauth_states WHERE expires_at < now();
    UPDATE public.x_posts SET status='uncertain', error_code='confirmation_required'
      WHERE status='processing' AND started_at < now()-interval '5 minutes';
  $job$);
END;
$$;
REVOKE ALL ON FUNCTION public.configure_x_worker(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_x_worker(text,text) TO service_role;
