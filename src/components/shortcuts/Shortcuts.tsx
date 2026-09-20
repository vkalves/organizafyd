import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Github, Globe, Pencil, Plus, Trash2, Youtube } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

const suggestions = [
  { title: "ChatGPT", url: "https://chatgpt.com" },
  { title: "YouTube", url: "https://www.youtube.com" },
  { title: "GitHub", url: "https://github.com" },
];

function safeUrl(value: string): string | null {
  try {
    const text = value.trim();
    if (!text) return null;
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !url.hostname.includes(".")) return null;
    return url.href;
  } catch { return null; }
}

function SiteIcon({ url }: { url: string }) {
  const host = new URL(safeUrl(url) || "https://example.com").hostname.replace(/^www\./, "");
  if (host === "chatgpt.com" || host === "chat.openai.com") return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
  const Icon = host === "github.com" ? Github : host === "youtube.com" || host === "youtu.be" ? Youtube : Globe;
  return <Icon className="h-5 w-5" aria-hidden="true" />;
}

export function Shortcuts() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const key = ["shortcuts", user?.id];
  const [managing, setManaging] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: key, enabled: !!user,
    queryFn: async () => {
      const result = await supabase.from("links").select("*").eq("user_id", user!.id).eq("type", "shortcut").order("created_at");
      if (result.error) throw result.error;
      return result.data;
    },
  });

  function edit(item?: Pick<Tables<"links">, "title" | "url"> & { id?: string }) {
    setEditing(item?.id || null); setTitle(item?.title || ""); setUrl(item?.url || ""); setOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const normalized = safeUrl(url);
    if (!normalized || !title.trim()) { toast.error("Informe um nome e um endereço válido (https://site.com)."); return; }
    if (!user || busy) return;
    setBusy(true);
    try {
      const values = { title: title.trim(), url: normalized, type: "shortcut", user_id: user.id };
      const result = editing
        ? await supabase.from("links").update(values).eq("id", editing).eq("user_id", user.id).select("id").single()
        : await supabase.from("links").insert(values).select("id").single();
      if (result.error) throw result.error;
      await cache.invalidateQueries({ queryKey: key });
      setOpen(false); toast.success("Atalho salvo!");
    } catch { toast.error("Não foi possível salvar o atalho. Tente novamente."); }
    finally { setBusy(false); }
  }

  async function remove(item: Tables<"links">) {
    if (!user || busy || !window.confirm(`Excluir o atalho “${item.title}”?`)) return;
    setBusy(true);
    try {
      const result = await supabase.from("links").delete().eq("id", item.id).eq("user_id", user.id).select("id").single();
      if (result.error) throw result.error;
      await cache.invalidateQueries({ queryKey: key });
      toast.success("Atalho excluído.");
    } catch { toast.error("Não foi possível excluir o atalho. Tente novamente."); }
    finally { setBusy(false); }
  }

  return <>
    <nav aria-label="Atalhos para sites" className="flex min-w-0 max-w-[8rem] items-center sm:max-w-[14rem] lg:max-w-[20rem]">
      <div className="flex min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {data.map(item => {
          const href = safeUrl(item.url);
          return href ? <a key={item.id} href={href} target="_blank" rel="noopener noreferrer" title={`${item.title} · Abrir em nova aba`} aria-label={`${item.title} (abre em nova aba)`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:h-10 sm:w-10"><SiteIcon url={item.url} /></a> : null;
        })}
      </div>
      <button type="button" onClick={() => setManaging(true)} title="Gerenciar atalhos" aria-label="Gerenciar atalhos" className="flex h-9 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus className="h-4 w-4" /></button>
    </nav>
    <Dialog open={managing} onOpenChange={setManaging}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Meus atalhos</DialogTitle><DialogDescription>Organize os ícones da barra superior. Cada site abre em uma nova aba.</DialogDescription></DialogHeader>
    <div className="flex flex-wrap items-center justify-between gap-3">

      <Button size="sm" variant="secondary" onClick={() => edit()} disabled={busy}><Plus className="mr-2 h-4 w-4" />Adicionar atalho</Button>
    </div>
    {isLoading ? <p className="mt-4 text-sm text-muted-foreground">Carregando atalhos...</p> : isError ? <div className="mt-4 text-sm">Não foi possível carregar os atalhos. <Button variant="link" onClick={() => void refetch()}>Tentar novamente</Button></div> : <>
      {data.length > 0 && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {data.map(item => {
          const href = safeUrl(item.url);
          return <div key={item.id} className="min-w-0 rounded-lg border border-border bg-background transition-colors hover:bg-accent/40">
            <a href={href || undefined} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} (abre em nova aba)`} aria-disabled={!href} className="flex min-h-28 flex-col items-center gap-2 rounded-lg px-3 py-4 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <SiteIcon url={item.url} /><span className="w-full truncate text-sm font-medium">{item.title}</span><ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
            </a>
            <div className="flex justify-center border-t border-border">
              <Button variant="ghost" size="icon" disabled={busy} aria-label={`Editar ${item.title}`} onClick={() => edit(item)}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" disabled={busy} aria-label={`Excluir ${item.title}`} onClick={() => void remove(item)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </div>;
        })}
      </div>}
      <div className="mt-4 flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">{data.length ? "Adicionar também:" : "Comece com:"}</span>
        {suggestions.filter(s => !data.some(d => safeUrl(d.url) === safeUrl(s.url))).map(s => <Button key={s.title} variant="outline" size="sm" disabled={busy} onClick={() => edit(s)}><Plus className="mr-1 h-3 w-3" />{s.title}</Button>)}
      </div>
    </>}
      </DialogContent>
    </Dialog>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{editing ? "Editar atalho" : "Adicionar atalho"}</DialogTitle><DialogDescription>Escolha um nome e o endereço do site. O ícone é definido pelo endereço.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="shortcut-name">Nome</Label><Input id="shortcut-name" value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: ChatGPT" required maxLength={80} disabled={busy} /></div>
          <div className="space-y-2"><Label htmlFor="shortcut-url">Endereço do site</Label><Input id="shortcut-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://chatgpt.com" inputMode="url" autoCapitalize="none" spellCheck={false} required maxLength={2048} disabled={busy} /></div>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar atalho"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
