import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Download, FileQuestion, Loader2, X } from "lucide-react";
import { fileCategory, formatBytes } from "./helpers";
import type { StructureItem } from "./types";

type ViewerItem = Pick<StructureItem, "id" | "kind" | "mime_type" | "original_name" | "size_bytes" | "title">;

interface FileViewerProps {
  items: ViewerItem[];
  currentId: string | null;
  allowDownload?: boolean;
  onChange: (id: string) => void;
  onClose: () => void;
  resolveUrl: (item: ViewerItem, download: boolean) => Promise<string>;
}

export function FileViewer({ items, currentId, allowDownload = true, onChange, onClose, resolveUrl }: FileViewerProps) {
  const files = useMemo(() => items.filter((item) => item.kind === "file"), [items]);
  const index = files.findIndex((item) => item.id === currentId);
  const item = index >= 0 ? files[index] : null;
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mediaError, setMediaError] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!item) return;
    let active = true;
    setLoading(true);
    setError("");
    setMediaError(false);
    setUrl("");
    resolveUrl(item, false)
      .then((nextUrl) => { if (active) setUrl(nextUrl); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Não foi possível abrir o arquivo."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [item, resolveUrl]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && index > 0) onChange(files[index - 1].id);
      if (event.key === "ArrowRight" && index >= 0 && index < files.length - 1) onChange(files[index + 1].id);
    };
    window.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [files, index, onChange, onClose]);

  if (!item) return null;
  const category = fileCategory(item);
  const hasNativePreview = category === "image" || category === "video" || category === "pdf";

  const handleDownload = async () => {
    if (!allowDownload || downloading) return;
    setDownloading(true);
    try {
      const downloadUrl = await resolveUrl(item, true);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = item.original_name || item.title || "arquivo";
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex min-h-0 flex-col bg-black/95 text-white" role="dialog" aria-modal="true" aria-label={`Visualizando ${item.original_name || "arquivo"}`}>
      <header className="flex min-h-16 shrink-0 items-center gap-2 border-b border-white/10 px-3 sm:px-5">
        <button type="button" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-white/10" aria-label="Fechar visualizador">
          <X className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.original_name || item.title || "Arquivo"}</p>
          <p className="text-xs text-white/55">{formatBytes(item.size_bytes)}{files.length > 1 ? ` · ${index + 1} de ${files.length}` : ""}</p>
        </div>
        {allowDownload && (
          <button type="button" onClick={() => void handleDownload()} disabled={downloading} className="flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium hover:bg-white/10 disabled:opacity-50" aria-label="Baixar arquivo original">
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="hidden sm:inline">Baixar</span>
          </button>
        )}
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2 sm:p-6">
        {loading && <Loader2 className="h-8 w-8 animate-spin text-white/70" aria-label="Carregando arquivo" />}
        {!loading && error && <ViewerFallback title="Não foi possível abrir" description={error} />}
        {!loading && !error && (!hasNativePreview || mediaError) && (
          <ViewerFallback
            title="Prévia indisponível"
            description={allowDownload ? "Este formato pode ser mantido e baixado no arquivo original." : "Este formato não pode ser exibido no navegador e o download foi desativado pelo proprietário."}
          />
        )}
        {!loading && !error && url && hasNativePreview && !mediaError && category === "image" && (
          <img src={url} alt={item.original_name || "Imagem"} onError={() => setMediaError(true)} className="h-full w-full object-contain" />
        )}
        {!loading && !error && url && hasNativePreview && !mediaError && category === "video" && (
          <video src={url} controls autoPlay playsInline onError={() => setMediaError(true)} className="max-h-full max-w-full rounded-lg bg-black" />
        )}
        {!loading && !error && url && hasNativePreview && !mediaError && category === "pdf" && (
          <iframe src={url} title={item.original_name || "Documento PDF"} onError={() => setMediaError(true)} className="h-full w-full rounded-lg border-0 bg-white" />
        )}

        {index > 0 && (
          <button type="button" onClick={() => onChange(files[index - 1].id)} className="absolute left-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 shadow-lg backdrop-blur hover:bg-black/75 sm:flex" aria-label="Arquivo anterior">
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        {index < files.length - 1 && (
          <button type="button" onClick={() => onChange(files[index + 1].id)} className="absolute right-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 shadow-lg backdrop-blur hover:bg-black/75 sm:flex" aria-label="Próximo arquivo">
            <ArrowRight className="h-5 w-5" />
          </button>
        )}
      </div>

      {files.length > 1 && (
        <footer className="flex shrink-0 items-center justify-center gap-3 border-t border-white/10 p-2 sm:hidden">
          <button type="button" disabled={index <= 0} onClick={() => onChange(files[index - 1].id)} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-white/10 text-sm disabled:opacity-30">
            <ArrowLeft className="h-4 w-4" /> Anterior
          </button>
          <button type="button" disabled={index >= files.length - 1} onClick={() => onChange(files[index + 1].id)} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-white/10 text-sm disabled:opacity-30">
            Próximo <ArrowRight className="h-4 w-4" />
          </button>
        </footer>
      )}
    </div>
  );
}

function ViewerFallback({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-6 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10"><FileQuestion className="h-8 w-8 text-white/70" /></div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-white/55">{description}</p>
    </div>
  );
}
