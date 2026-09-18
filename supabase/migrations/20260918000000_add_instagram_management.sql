-- Instagram account warm-up management.
-- All tables are isolated by user_id and protected by RLS.

CREATE TABLE IF NOT EXISTS public.instagram_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  joined_at DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'aquecimento' CHECK (status IN ('aquecimento', 'aquecida')),
  observations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT instagram_accounts_user_username_key UNIQUE (user_id, username)
);

CREATE TABLE IF NOT EXISTS public.instagram_warmup_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  day_number SMALLINT NOT NULL CHECK (day_number BETWEEN 1 AND 8),
  task_index SMALLINT NOT NULL CHECK (task_index >= 0),
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT instagram_warmup_progress_task_key UNIQUE (account_id, day_number, task_index)
);

CREATE TABLE IF NOT EXISTS public.instagram_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS instagram_accounts_user_id_idx
  ON public.instagram_accounts(user_id);
CREATE INDEX IF NOT EXISTS instagram_warmup_progress_user_account_idx
  ON public.instagram_warmup_progress(user_id, account_id);
CREATE INDEX IF NOT EXISTS instagram_videos_user_account_idx
  ON public.instagram_videos(user_id, account_id);

ALTER TABLE public.instagram_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_warmup_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users CRUD own instagram accounts" ON public.instagram_accounts;
CREATE POLICY "Users CRUD own instagram accounts"
  ON public.instagram_accounts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users CRUD own instagram progress" ON public.instagram_warmup_progress;
CREATE POLICY "Users CRUD own instagram progress"
  ON public.instagram_warmup_progress FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.instagram_accounts account
      WHERE account.id = account_id AND account.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users CRUD own instagram videos" ON public.instagram_videos;
CREATE POLICY "Users CRUD own instagram videos"
  ON public.instagram_videos FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.instagram_accounts account
      WHERE account.id = account_id AND account.user_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS update_instagram_accounts_updated_at ON public.instagram_accounts;
CREATE TRIGGER update_instagram_accounts_updated_at
  BEFORE UPDATE ON public.instagram_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
