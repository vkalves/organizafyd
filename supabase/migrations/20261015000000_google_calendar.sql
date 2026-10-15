-- OAuth credentials, event mappings and durable task sync are server-only.
CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  google_account_id text NOT NULL,
  calendar_id text NOT NULL DEFAULT 'primary',
  calendar_summary text NOT NULL DEFAULT 'Agenda principal',
  refresh_token_encrypted text NOT NULL,
  access_token_encrypted text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  sync_error text,
  reconnect_required boolean NOT NULL DEFAULT false,
  sync_lock_token uuid,
  sync_locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.google_calendar_oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_verifier_encrypted text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS google_calendar_oauth_states_expiry
  ON public.google_calendar_oauth_states(expires_at);

-- Keep mappings after task deletion so workers can remove the Google event.
CREATE TABLE IF NOT EXISTS public.google_calendar_task_events (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id uuid NOT NULL,
  calendar_id text NOT NULL,
  event_id text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, task_id)
);

CREATE TABLE IF NOT EXISTS public.google_calendar_sync_queue (
  user_id uuid NOT NULL REFERENCES public.google_calendar_connections(user_id) ON DELETE CASCADE,
  task_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, task_id)
);
CREATE INDEX IF NOT EXISTS google_calendar_sync_queue_due
  ON public.google_calendar_sync_queue(next_attempt_at, user_id);

-- Locks must also exist before the first connection is created: two OAuth
-- callbacks cannot swap Google accounts while the first sync is running.
CREATE TABLE IF NOT EXISTS public.google_calendar_user_locks (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  lock_token uuid NOT NULL,
  locked_until timestamptz NOT NULL
);

ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_calendar_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_calendar_task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_calendar_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_calendar_user_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_calendar_connections, public.google_calendar_oauth_states,
  public.google_calendar_task_events, public.google_calendar_sync_queue, public.google_calendar_user_locks
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.google_calendar_connections, public.google_calendar_oauth_states,
  public.google_calendar_task_events, public.google_calendar_sync_queue, public.google_calendar_user_locks TO service_role;

CREATE OR REPLACE FUNCTION public.google_calendar_enqueue_task()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  owner_id uuid;
  changed_task_id uuid;
  connection_exists boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    owner_id := OLD.user_id;
    changed_task_id := OLD.id;
  ELSE
    owner_id := NEW.user_id;
    changed_task_id := NEW.id;
  END IF;

  -- A concurrent disconnect waits for this task transaction, then cascades
  -- its queue. Saving a task must not fail because a connection disappeared.
  SELECT true INTO connection_exists FROM public.google_calendar_connections
    WHERE user_id = owner_id FOR KEY SHARE;
  IF connection_exists THEN
    INSERT INTO public.google_calendar_sync_queue(user_id, task_id)
      VALUES (owner_id, changed_task_id)
    ON CONFLICT (user_id, task_id) DO UPDATE SET
      revision = public.google_calendar_sync_queue.revision + 1,
      attempts = 0, last_error = NULL,
      next_attempt_at = now(), updated_at = now();
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.google_calendar_enqueue_task() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS google_calendar_tasks_changed ON public.tasks;
CREATE TRIGGER google_calendar_tasks_changed
  AFTER INSERT OR DELETE OR UPDATE OF title, description, due_date, status, completed_at, is_fixed_daily
  ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.google_calendar_enqueue_task();

CREATE OR REPLACE FUNCTION public.google_calendar_enqueue_all(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE queued integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.google_calendar_connections WHERE user_id = p_user_id) THEN
    RETURN 0;
  END IF;
  INSERT INTO public.google_calendar_sync_queue(user_id, task_id)
    SELECT p_user_id, id FROM (
      SELECT id FROM public.tasks WHERE user_id = p_user_id
      UNION
      SELECT task_id FROM public.google_calendar_task_events WHERE user_id = p_user_id
    ) AS task_ids
  ON CONFLICT (user_id, task_id) DO UPDATE SET
    revision = public.google_calendar_sync_queue.revision + 1,
    attempts = 0, last_error = NULL,
    next_attempt_at = now(), updated_at = now();
  GET DIAGNOSTICS queued = ROW_COUNT;
  RETURN queued;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_calendar_claim_lock(
  p_user_id uuid, p_lock_token uuid, p_lease_seconds integer DEFAULT 90
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.google_calendar_user_locks(user_id, lock_token, locked_until)
    VALUES (p_user_id, p_lock_token, now() + make_interval(secs => greatest(10, least(p_lease_seconds, 300))))
  ON CONFLICT (user_id) DO UPDATE SET
    lock_token = EXCLUDED.lock_token, locked_until = EXCLUDED.locked_until
    WHERE public.google_calendar_user_locks.lock_token = p_lock_token
      OR public.google_calendar_user_locks.locked_until < now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_calendar_release_lock(p_user_id uuid, p_lock_token uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.google_calendar_user_locks
    WHERE user_id = p_user_id AND lock_token = p_lock_token;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.google_calendar_enqueue_all(uuid),
  public.google_calendar_claim_lock(uuid, uuid, integer),
  public.google_calendar_release_lock(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_calendar_enqueue_all(uuid),
  public.google_calendar_claim_lock(uuid, uuid, integer),
  public.google_calendar_release_lock(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.google_calendar_select_calendar(
  p_user_id uuid, p_calendar_id text, p_calendar_summary text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.google_calendar_connections
    SET calendar_id = p_calendar_id, calendar_summary = p_calendar_summary,
      sync_error = NULL, updated_at = now()
    WHERE user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Google Calendar is not connected'; END IF;
  -- Calendar choice and queued event moves must commit together.
  PERFORM public.google_calendar_enqueue_all(p_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.google_calendar_select_calendar(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_calendar_select_calendar(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.google_calendar_disconnect(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.google_calendar_connections WHERE user_id = p_user_id;
  DELETE FROM public.google_calendar_sync_queue WHERE user_id = p_user_id;
  DELETE FROM public.google_calendar_oauth_states WHERE user_id = p_user_id;
  -- Events remain in Google. Keep their server-only IDs to reuse on reconnect
  -- to the same actual calendar instead of creating duplicate events.
END;
$$;

CREATE OR REPLACE FUNCTION public.google_calendar_due_users(
  p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 20
)
RETURNS TABLE(user_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT q.user_id FROM public.google_calendar_sync_queue AS q
    JOIN public.google_calendar_connections AS c ON c.user_id = q.user_id
    WHERE q.next_attempt_at <= p_now AND NOT c.reconnect_required
    GROUP BY q.user_id ORDER BY min(q.next_attempt_at), q.user_id
    LIMIT greatest(1, least(p_limit, 100));
$$;
REVOKE ALL ON FUNCTION public.google_calendar_disconnect(uuid),
  public.google_calendar_due_users(timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_calendar_disconnect(uuid),
  public.google_calendar_due_users(timestamptz, integer) TO service_role;

-- Optional installation RPC for the durable background worker. The earlier
-- project migration enables pg_cron/pg_net; Supabase provides Vault.
-- Secrets are never embedded in cron.job.command or sent to the browser.
CREATE OR REPLACE FUNCTION public.configure_google_calendar_worker(
  p_project_url text, p_worker_secret text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  secret_id uuid;
  existing_job bigint;
BEGIN
  IF p_project_url IS NULL OR p_project_url !~ '^https://[a-z0-9]+\.supabase\.co/?$' THEN
    RAISE EXCEPTION 'Expected the HTTPS Supabase project URL';
  END IF;
  IF p_worker_secret IS NULL OR length(p_worker_secret) < 32 OR p_worker_secret ~ '\s' THEN
    RAISE EXCEPTION 'Worker secret must contain at least 32 characters and no whitespace';
  END IF;

  SELECT id INTO secret_id FROM vault.secrets WHERE name = 'google_calendar_project_url';
  IF secret_id IS NULL THEN
    PERFORM vault.create_secret(rtrim(p_project_url, '/'), 'google_calendar_project_url');
  ELSE
    PERFORM vault.update_secret(secret_id, rtrim(p_project_url, '/'));
  END IF;
  SELECT id INTO secret_id FROM vault.secrets WHERE name = 'google_calendar_worker_secret';
  IF secret_id IS NULL THEN
    PERFORM vault.create_secret(p_worker_secret, 'google_calendar_worker_secret');
  ELSE
    PERFORM vault.update_secret(secret_id, p_worker_secret);
  END IF;

  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname = 'google-calendar-task-sync'
  LOOP
    PERFORM cron.unschedule(existing_job);
  END LOOP;
  PERFORM cron.schedule('google-calendar-task-sync', '* * * * *', $job$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'google_calendar_project_url') || '/functions/v1/google-calendar',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Calendar-Worker-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'google_calendar_worker_secret')
      ),
      body := '{"action":"process_queue"}'::jsonb,
      timeout_milliseconds := 120000
    );
    DELETE FROM public.google_calendar_oauth_states WHERE expires_at < now();
  $job$);
END;
$$;
REVOKE ALL ON FUNCTION public.configure_google_calendar_worker(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_google_calendar_worker(text, text) TO service_role;
