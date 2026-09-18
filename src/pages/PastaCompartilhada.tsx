import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, FolderOpen, Link2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import logoImg from "@/assets/logo-organify.png";
import { FileViewer } from "@/features/structures/FileViewer";
import { StructureIcon } from "@/features/structures/StructureIcon";
import { StructureItemCard } from "@/features/structures/StructureItemCard";
import { fileCategory, formatDayLabel, formatRelativeDate } from "@/features/structures/helpers";
import type { SharedFolderPayload, StructureItem } from "@/features/structures/types";

const PastaCompartilhada = () => {
  const { token = "" } = useParams();
  const [payload, setPayload] = useState<SharedFolderPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewerId, setViewerId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());

  const fileUrl = useCallback((itemId: string, download = false) => {
    const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/structure-share`;
    const params = new URLSearchParams({ token, action: "file", item: itemId });
    if (download) params.set("download", "1");
    return `${base}?${params.toString()}`;
  }, [token]);

  const loadFolder = useCallback(async (folderId?: string) => {
    setLoading(true);
    setError("");
    try {
      const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/structure-share`;
      const params = new URLSearchParams({ token, action: "browse" });
      if (folderId) params.set("folder", folderId);
      const response = await fetch(`${base}?${params.toString()}`, { headers: { Accept: "application/json" } });
      const body = await response.json() as SharedFolderPayload | { error?: string };
      if (!response.ok || !("current_folder" in body)) throw new Error("error" in body ? body.error || "Link indisponível." : "Link indisponível.");
      setPayload(body);
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollPositions.current.get(body.current_folder.id) ?? 0; });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir esta pasta.");
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void loadFolder(); }, [loadFolder]);

  useEffect(() => {
    if (!payload?.current_folder.id) return;
    const interval = window.setInterval(() => { void loadFolder(payload.current_folder.id); }, 60_000);
    return () => window.clearInterval(interval);
  }, [loadFolder, payload?.current_folder.id]);

  const navigateFolder = (folderId: string) => {
    if (payload && scrollRef.current) scrollPositions.current.set(payload.current_folder.id, scrollRef.current.scrollTop);
    void loadFolder(folderId);
  };

  const back = () => {
    if (!payload) return;
    const previous = payload.breadcrumbs.at(-2);
    if (previous) navigateFolder(previous.id);
    else window.history.back();
  };

  const dayGroups = useMemo(() => {
    const groups = new Map<string, SharedFolderPayload["items"]>();
    for (const item of payload?.items ?? []) {
      const key = new Date(item.created_at).toDateString();
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return Array.from(groups.values());
  }, [payload?.items]);

  const resolveSharedFileUrl = useCallback(async (item: Pick<StructureItem, "id">, download: boolean) => fileUrl(item.id, download), [fileUrl]);

  const downloadItem = async (itemId: string, name?: string | null) => {
    const anchor = document.createElement("a");
    anchor.href = fileUrl(itemId, true);
    anchor.download = name || "arquivo";
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  if (error) return <PublicError message={error} onRetry={() => void loadFolder()} />;
  if (loading && !payload) return <PublicLoading />;

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col bg-background text-foreground">
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-3 sm:px-5">
        <button type="button" onClick={back} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Voltar"><ArrowLeft className="h-5 w-5" /></button>
        <img src={logoImg} alt="Organizafy" className="hidden h-7 w-auto sm:block" />
        <div className="hidden h-6 w-px bg-border sm:block" />
        {payload && <><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${payload.structure.color}24`, color: payload.structure.color }}><StructureIcon name={payload.structure.icon} className="h-5 w-5" /></div><div className="min-w-0 flex-1"><h1 className="truncate text-sm font-semibold">{payload.structure.name}</h1><p className="flex items-center gap-1 text-[11px] text-muted-foreground"><ShieldCheck className="h-3 w-3" />Pasta compartilhada · atualizada {formatRelativeDate(payload.updated_at)}</p></div></>}
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
        {payload && <>
          <div className="flex min-h-14 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-4 scrollbar-none">
            {payload.breadcrumbs.map((crumb, index) => <span key={crumb.id} className="flex items-center gap-1"><button type="button" onClick={() => navigateFolder(crumb.id)} className={cn("max-w-[12rem] truncate rounded-md px-2 py-1.5 text-sm", index === payload.breadcrumbs.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>{crumb.name}</button>{index < payload.breadcrumbs.length - 1 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}</span>)}
            <button type="button" onClick={() => void loadFolder(payload.current_folder.id)} disabled={loading} className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40" aria-label="Atualizar pasta compartilhada"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></button>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6">
            {loading && <div className="sticky top-0 z-20 mb-3 flex justify-center"><span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow"><Loader2 className="h-3.5 w-3.5 animate-spin" />Atualizando...</span></div>}

            {payload.folders.length > 0 && <section className="mb-6"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Subpastas</p><div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{payload.folders.map((folder) => <button key={folder.id} type="button" onClick={() => navigateFolder(folder.id)} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/55"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${folder.color}24`, color: folder.color }}><StructureIcon name={folder.icon} className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{folder.name}</p><p className="text-xs text-muted-foreground">Abrir pasta</p></div><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /></button>)}</div></section>}

            {!payload.items.length && !payload.folders.length ? <div className="flex min-h-[55vh] flex-col items-center justify-center px-6 text-center"><div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary text-muted-foreground"><FolderOpen className="h-8 w-8" /></div><h2 className="mt-4 text-base font-semibold">Pasta vazia</h2><p className="mt-1 text-sm text-muted-foreground">Ainda não há conteúdo disponível aqui.</p></div> : <div className="flex flex-col gap-4">{dayGroups.map((dayItems) => <section key={new Date(dayItems[0].created_at).toDateString()} className="flex flex-col gap-2.5"><div className="sticky top-0 z-10 flex justify-center py-1"><span className="rounded-full border border-border bg-card/90 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">{formatDayLabel(dayItems[0].created_at)}</span></div>{groupMessages(dayItems).map((group) => group.length > 1 ? <div key={group[0].id} className="grid w-full max-w-[min(42rem,94%)] self-end grid-cols-1 gap-1.5 rounded-2xl rounded-br-md bg-secondary/40 p-1.5 sm:grid-cols-2">{group.map((item) => <StructureItemCard key={item.id} item={item} readonly compact allowDownload={payload.allow_download} previewUrl={["image", "video"].includes(fileCategory(item)) ? fileUrl(item.id) : undefined} onOpenFile={() => setViewerId(item.id)} onDownload={() => downloadItem(item.id, item.original_name)} />)}</div> : <StructureItemCard key={group[0].id} item={group[0]} readonly allowDownload={payload.allow_download} previewUrl={["image", "video"].includes(fileCategory(group[0])) ? fileUrl(group[0].id) : undefined} onOpenFile={() => setViewerId(group[0].id)} onDownload={() => downloadItem(group[0].id, group[0].original_name)} />)}</section>)}</div>}
          </div>

          <footer className="safe-bottom-padding flex shrink-0 items-center justify-center gap-2 border-t border-border bg-card px-3 py-2 text-center text-[11px] leading-4 text-muted-foreground"><Link2 className="h-3.5 w-3.5 shrink-0" />Somente visualização{payload.allow_download ? " · downloads permitidos" : " · downloads desativados"}</footer>
        </>}
      </main>

      {payload && viewerId && <FileViewer items={payload.items} currentId={viewerId} allowDownload={payload.allow_download} onChange={setViewerId} onClose={() => setViewerId(null)} resolveUrl={resolveSharedFileUrl} />}
    </div>
  );
};

function PublicLoading() {
  return <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background text-foreground"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /><p className="mt-4 text-sm text-muted-foreground">Abrindo pasta compartilhada...</p></div>;
}

function PublicError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6 text-center text-foreground"><div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary text-muted-foreground"><FolderOpen className="h-8 w-8" /></div><h1 className="mt-4 text-lg font-semibold">Não foi possível abrir a pasta</h1><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{message}</p><button type="button" onClick={onRetry} className="mt-5 flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"><RefreshCw className="h-4 w-4" />Tentar novamente</button></div>;
}

function groupMessages<T extends { kind: string; upload_group: string | null }>(items: T[]) {
  const groups: T[][] = [];
  for (const item of items) {
    const previous = groups.at(-1);
    if (item.kind === "file" && item.upload_group && previous?.[0]?.upload_group === item.upload_group) previous.push(item);
    else groups.push([item]);
  }
  return groups;
}

export default PastaCompartilhada;
