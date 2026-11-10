-- Private, short-lived account choices use the existing one-use login state lifecycle.
-- Only service_role has table access; grants and RLS remain unchanged.
ALTER TABLE public.ig_login_states ADD COLUMN pending_grant text;
COMMENT ON COLUMN public.ig_login_states.pending_grant IS
  'AES-256-GCM encrypted Meta grant for explicit account selection; expires with the login state.';
