import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Link2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { MediaBoard, type MediaCardKind, type MediaItem } from "@/components/media/MediaBoard";

const BUCKET = "media";

function publicUrl(path: string) {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function toItem(row: any): MediaItem {
  return {
    id: row.id,
    card: row.card,
    name: row.name,
    mime_type: row.mime_type,
    storage_path: row.storage_path,
    public_url: publicUrl(row.storage_path),
    created_at: row.created_at,
  };
}

function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 80);
}

const Midia = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingCard, setUploadingCard] = useState<MediaCardKind | null>(null);
  const [publicLink, setPublicLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await (supabase.from("media_items") as any)
      .select("id, card, name, mime_type, storage_path, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) toast.error(`Erro ao carregar: ${error.message}`);
    else setItems((data || []).map(toItem));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const referencias = useMemo(
    () => items.filter((i) => i.card === "referencias"),
    [items],
  );
  const originais = useMemo(
    () => items.filter((i) => i.card === "original"),
    [items],
  );

  const addFiles = async (card: MediaCardKind, files: FileList) => {
    if (!user) return;
    setUploadingCard(card);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
          toast.error(`${file.name} não é foto ou vídeo`);
          continue;
        }
        const path = `${user.id}/${card}/${crypto.randomUUID()}-${safeName(file.name)}`;
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) {
          toast.error(`Falha no upload: ${uploadError.message}`);
          continue;
        }
        const { data, error } = await (supabase.from("media_items") as any)
          .insert({
            user_id: user.id,
            card,
            name: file.name,
            mime_type: file.type || "application/octet-stream",
            storage_path: path,
          })
          .select("id, card, name, mime_type, storage_path, created_at")
          .single();
        if (error) {
          await supabase.storage.from(BUCKET).remove([path]);
          toast.error(`Erro ao salvar: ${error.message}`);
          continue;
        }
        setItems((prev) => [toItem(data), ...prev]);
      }
    } finally {
      setUploadingCard(null);
    }
  };

  const removeItem = async (item: MediaItem) => {
    const { error } = await (supabase.from("media_items") as any)
      .delete()
      .eq("id", item.id);
    if (error) {
      toast.error(`Erro ao excluir: ${error.message}`);
      return;
    }
    await supabase.storage.from(BUCKET).remove([item.storage_path]);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    toast.success("Arquivo removido");
  };

  const generatePublicLink = async () => {
    if (!user) return;
    const { data: existing, error: existingError } = await (
      supabase.from("media_public_links") as any
    )
      .select("token")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existingError) {
      toast.error(`Erro ao gerar link: ${existingError.message}`);
      return;
    }
    let token = existing?.token as string | undefined;
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, "");
      const { error } = await (supabase.from("media_public_links") as any).insert({
        user_id: user.id,
        token,
      });
      if (error) {
        toast.error(`Erro ao gerar link: ${error.message}`);
        return;
      }
    }
    const url = `${window.location.origin}/p/${token}`;
    setPublicLink(url);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link público copiado");
    } catch {
      toast.success("Link público gerado");
    }
  };

  if (loading) {
    return (
      <div className="mx-auto min-w-0 max-w-6xl animate-pulse space-y-6">
        <div className="h-8 w-48 rounded bg-secondary" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="h-64 rounded-lg border border-border bg-card" />
          <div className="h-64 rounded-lg border border-border bg-card" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Referências e Original
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Fotos e vídeos em dois cards. Sem pastas e sem projetos.
          </p>
        </div>
        <button
          type="button"
          onClick={generatePublicLink}
          className="flex min-h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Link2 className="h-4 w-4" />
          Gerar link público
        </button>
      </div>

      {publicLink ? (
        <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-sm text-foreground">{publicLink}</p>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(publicLink);
              toast.success("Link copiado");
            }}
            className="rounded-md p-1.5 hover:bg-accent"
            title="Copiar"
          >
            <Copy className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MediaBoard
          title="Referências"
          items={referencias}
          canEdit
          uploading={uploadingCard === "referencias"}
          onAdd={(files) => addFiles("referencias", files)}
          onRemove={removeItem}
        />
        <MediaBoard
          title="Original"
          items={originais}
          canEdit
          uploading={uploadingCard === "original"}
          onAdd={(files) => addFiles("original", files)}
          onRemove={removeItem}
        />
      </div>
    </div>
  );
};

export default Midia;
