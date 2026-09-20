import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Github, Globe, MessageCircle, Pencil, Plus, Trash2, Youtube } from "lucide-react";
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
  const Icon = host === "github.com" ? Github : host === "youtube.com" || host === "youtu.be" ? Youtube : host === "chatgpt.com" || host === "chat.openai.com" ? MessageCircle : Globe;
  return <Icon className="h-6 w-6" aria-hidden="true" />;
}

export function Shortcuts() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const key = ["shortcuts", user?.id];
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

  return <section aria-labelledby="shortcuts-heading" className="rounded-lg border border-border bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="shortcuts-heading" className="font-semibold">Meus atalhos</h2><p className="text-xs text-muted-foreground mt-1">Seus sites favoritos, sempre em uma nova aba.</p></div>
      <Button size="sm" variant="secondary" onClick={() => edit()} disabled={busy}><Plus className="mr-2 h-4 w-4" />Adicionar atalho</Button>
    </div>
    {isLoading ? <p className="mt-4 text-sm text-muted-foreground">Carregando atalhos...</p> : isError ? <div className="mt-4 text-sm">Não foi possível carregar os atalhos. <Button variant="link" onClick={() => void refetch()}>Tentar novamente</Button></div> : <>
      {data.length > 0 && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{editing ? "Editar atalho" : "Adicionar atalho"}</DialogTitle><DialogDescription>Escolha um nome e o endereço do site. O ícone é definido pelo endereço.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="shortcut-name">Nome</Label><Input id="shortcut-name" value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: ChatGPT" required maxLength={80} disabled={busy} /></div>
          <div className="space-y-2"><Label htmlFor="shortcut-url">Endereço do site</Label><Input id="shortcut-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://chatgpt.com" inputMode="url" autoCapitalize="none" spellCheck={false} required maxLength={2048} disabled={busy} /></div>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar atalho"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}
