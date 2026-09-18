-- Estruturas: hierarchical folders, private files, notes, links and secure shares.

CREATE TABLE public.structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  description TEXT,
  image_path TEXT,
  icon TEXT NOT NULL DEFAULT 'layers',
  color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.structure_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_id UUID NOT NULL REFERENCES public.structures(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.structure_folders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  icon TEXT NOT NULL DEFAULT 'folder',
  color TEXT NOT NULL DEFAULT '#3b82f6',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.structure_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_id UUID NOT NULL REFERENCES public.structures(id) ON DELETE CASCADE,
  folder_id UUID NOT NULL REFERENCES public.structure_folders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'text', 'link')),
  title TEXT,
  body TEXT,
  url TEXT,
  storage_path TEXT,
  original_name TEXT,
  mime_type TEXT,
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  upload_group UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT structure_items_file_fields CHECK (
    kind <> 'file' OR (storage_path IS NOT NULL AND original_name IS NOT NULL AND size_bytes IS NOT NULL)
  ),
  CONSTRAINT structure_items_link_fields CHECK (
    kind <> 'link' OR url IS NOT NULL
  )
);

CREATE TABLE public.structure_folder_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  root_folder_id UUID NOT NULL UNIQUE REFERENCES public.structure_folders(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  allow_download BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX structures_user_updated_idx ON public.structures(user_id, updated_at DESC);
CREATE INDEX structure_folders_structure_parent_idx ON public.structure_folders(structure_id, parent_id, position, created_at);
CREATE INDEX structure_folders_user_idx ON public.structure_folders(user_id);
CREATE INDEX structure_items_folder_created_idx ON public.structure_items(folder_id, created_at);
CREATE INDEX structure_items_structure_idx ON public.structure_items(structure_id);
CREATE INDEX structure_items_user_idx ON public.structure_items(user_id);
CREATE INDEX structure_items_search_idx ON public.structure_items USING gin (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, '') || ' ' || coalesce(url, '') || ' ' || coalesce(original_name, ''))
);

ALTER TABLE public.structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.structure_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.structure_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.structure_folder_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own structures"
ON public.structures FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own structure folders"
ON public.structure_folders FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own structure items"
ON public.structure_items FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own folder shares"
ON public.structure_folder_shares FOR ALL
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

CREATE TRIGGER update_structures_updated_at
BEFORE UPDATE ON public.structures
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_structure_folders_updated_at
BEFORE UPDATE ON public.structure_folders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_structure_items_updated_at
BEFORE UPDATE ON public.structure_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_structure_folder_shares_updated_at
BEFORE UPDATE ON public.structure_folder_shares
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enforce ownership, same-structure parents and cycle prevention at the database layer.
CREATE OR REPLACE FUNCTION public.validate_structure_folder_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_structure UUID;
  parent_user UUID;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Uma pasta não pode ficar dentro dela mesma.';
  END IF;

  SELECT structure_id, user_id
    INTO parent_structure, parent_user
  FROM public.structure_folders
  WHERE id = NEW.parent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pasta de destino não encontrada.';
  END IF;

  IF parent_structure <> NEW.structure_id OR parent_user <> NEW.user_id THEN
    RAISE EXCEPTION 'A pasta de destino pertence a outra estrutura ou usuário.';
  END IF;

  IF EXISTS (
    WITH RECURSIVE descendants AS (
      SELECT id FROM public.structure_folders WHERE parent_id = NEW.id
      UNION ALL
      SELECT child.id
      FROM public.structure_folders child
      JOIN descendants parent ON child.parent_id = parent.id
    )
    SELECT 1 FROM descendants WHERE id = NEW.parent_id
  ) THEN
    RAISE EXCEPTION 'Uma pasta não pode ser movida para dentro de uma descendente.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_structure_folder_hierarchy_trigger
BEFORE INSERT OR UPDATE OF parent_id, structure_id, user_id
ON public.structure_folders
FOR EACH ROW EXECUTE FUNCTION public.validate_structure_folder_hierarchy();

CREATE OR REPLACE FUNCTION public.validate_structure_item_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  destination_structure UUID;
  destination_user UUID;
BEGIN
  SELECT structure_id, user_id
    INTO destination_structure, destination_user
  FROM public.structure_folders
  WHERE id = NEW.folder_id;

  IF NOT FOUND OR destination_structure <> NEW.structure_id OR destination_user <> NEW.user_id THEN
    RAISE EXCEPTION 'O conteúdo deve pertencer à mesma estrutura e ao mesmo usuário da pasta.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_structure_item_location_trigger
BEFORE INSERT OR UPDATE OF folder_id, structure_id, user_id
ON public.structure_items
FOR EACH ROW EXECUTE FUNCTION public.validate_structure_item_location();

CREATE OR REPLACE FUNCTION public.validate_structure_share_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  folder_owner UUID;
BEGIN
  SELECT user_id INTO folder_owner
  FROM public.structure_folders
  WHERE id = NEW.root_folder_id;

  IF NOT FOUND OR folder_owner <> NEW.owner_id THEN
    RAISE EXCEPTION 'A pasta compartilhada deve pertencer ao proprietário do link.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_structure_share_owner_trigger
BEFORE INSERT OR UPDATE OF root_folder_id, owner_id
ON public.structure_folder_shares
FOR EACH ROW EXECUTE FUNCTION public.validate_structure_share_owner();

-- Keep the useful "last updated" information on the structure list current.
CREATE OR REPLACE FUNCTION public.touch_parent_structure()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.structures
  SET updated_at = now()
  WHERE id = COALESCE(NEW.structure_id, OLD.structure_id);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER touch_structure_from_folder
AFTER INSERT OR UPDATE OR DELETE ON public.structure_folders
FOR EACH ROW EXECUTE FUNCTION public.touch_parent_structure();

CREATE TRIGGER touch_structure_from_item
AFTER INSERT OR UPDATE OR DELETE ON public.structure_items
FOR EACH ROW EXECUTE FUNCTION public.touch_parent_structure();

-- Used only by the server-side share function to validate descendant access.
CREATE OR REPLACE FUNCTION public.structure_folder_is_within(candidate UUID, root UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE lineage AS (
    SELECT id, parent_id
    FROM public.structure_folders
    WHERE id = candidate
    UNION ALL
    SELECT parent.id, parent.parent_id
    FROM public.structure_folders parent
    JOIN lineage child ON child.parent_id = parent.id
  )
  SELECT EXISTS (SELECT 1 FROM lineage WHERE id = root);
$$;

REVOKE ALL ON FUNCTION public.structure_folder_is_within(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.structure_folder_is_within(UUID, UUID) TO service_role;

-- Share lifecycle is server-generated, so links remain cryptographically unguessable.
CREATE OR REPLACE FUNCTION public.manage_structure_folder_share(
  p_folder_id UUID,
  p_action TEXT,
  p_allow_download BOOLEAN DEFAULT true
)
RETURNS public.structure_folder_shares
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user UUID := auth.uid();
  folder_owner UUID;
  result public.structure_folder_shares;
BEGIN
  IF current_user IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  SELECT user_id INTO folder_owner
  FROM public.structure_folders
  WHERE id = p_folder_id;

  IF NOT FOUND OR folder_owner <> current_user THEN
    RAISE EXCEPTION 'Pasta não encontrada ou sem permissão.';
  END IF;

  IF p_action = 'enable' THEN
    INSERT INTO public.structure_folder_shares (root_folder_id, owner_id, allow_download, active)
    VALUES (p_folder_id, current_user, p_allow_download, true)
    ON CONFLICT (root_folder_id) DO UPDATE
      SET active = true,
          allow_download = EXCLUDED.allow_download,
          updated_at = now()
    RETURNING * INTO result;
  ELSIF p_action = 'rotate' THEN
    UPDATE public.structure_folder_shares
    SET token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
        allow_download = p_allow_download,
        active = true,
        updated_at = now()
    WHERE root_folder_id = p_folder_id AND owner_id = current_user
    RETURNING * INTO result;

    IF result.id IS NULL THEN
      INSERT INTO public.structure_folder_shares (root_folder_id, owner_id, allow_download, active)
      VALUES (p_folder_id, current_user, p_allow_download, true)
      RETURNING * INTO result;
    END IF;
  ELSIF p_action = 'disable' THEN
    UPDATE public.structure_folder_shares
    SET active = false, updated_at = now()
    WHERE root_folder_id = p_folder_id AND owner_id = current_user
    RETURNING * INTO result;
  ELSIF p_action = 'permissions' THEN
    UPDATE public.structure_folder_shares
    SET allow_download = p_allow_download, updated_at = now()
    WHERE root_folder_id = p_folder_id AND owner_id = current_user
    RETURNING * INTO result;
  ELSE
    RAISE EXCEPTION 'Ação de compartilhamento inválida.';
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.manage_structure_folder_share(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_structure_folder_share(UUID, TEXT, BOOLEAN) TO authenticated;

-- One private bucket for original files and structure images. 50 MB is the real
-- per-file limit surfaced by the interface.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'structure-files',
  'structure-files',
  false,
  52428800,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'application/pdf', 'text/plain', 'text/csv',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed',
    'application/vnd.rar', 'application/x-7z-compressed', 'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Users can read own structure files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'structure-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can upload own structure files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'structure-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update own structure files"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'structure-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'structure-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete own structure files"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'structure-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
