import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { MediaBoard, type MediaItem } from "@/components/media/MediaBoard";
import logoImg from "@/assets/logo-organify.png";

const BUCKET = "media";
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");

function publicUrl(path: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

const MidiaPublica = () => {
  const { token } = useParams();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    const load = async () => {
      const { data, error } = await (supabase.rpc as any)("get_public_media", {
        p_token: token,
      });
      if (error) {
        setInvalid(true);
      } else {
        setItems(
          (data || []).map((row: any) => ({
            id: row.id,
            card: row.card,
            name: row.name,
            mime_type: row.mime_type,
            storage_path: row.storage_path,
            public_url: publicUrl(row.storage_path),
            created_at: row.created_at,
          })),
        );
      }
      setLoading(false);
    };
    load();
  }, [token]);

  const referencias = useMemo(
    () => items.filter((i) => i.card === "referencias"),
    [items],
  );
  const originais = useMemo(
    () => items.filter((i) => i.card === "original"),
    [items],
  );

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-6">
        <img src={logoImg} alt="Organizafy" className="h-7 object-contain object-left" />
      </header>
      <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Referências e Original
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Somente visualização</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="h-64 animate-pulse rounded-lg border border-border bg-card" />
            <div className="h-64 animate-pulse rounded-lg border border-border bg-card" />
          </div>
        ) : invalid ? (
          <p className="text-sm text-muted-foreground">Link inválido ou indisponível.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <MediaBoard title="Referências" items={referencias} canEdit={false} />
            <MediaBoard title="Original" items={originais} canEdit={false} />
          </div>
        )}
      </main>
    </div>
  );
};

export default MidiaPublica;
