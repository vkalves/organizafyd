import { Link2, Plus, ExternalLink, Copy, Trash2, Edit2, Save, Search, FileText, FolderOpen } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

interface LinkItem {
  id: string;
  title: string;
  url: string;
  description: string | null;
  type: string | null;
  folder: string | null;
  tags: string[] | null;
  created_at: string;
}

const normalizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const isValidUrl = (str: string) => {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const LinksPage = () => {
  const { data: links, loading, create, update, remove } = useSupabaseCrud<LinkItem>("links");
  const [showDialog, setShowDialog] = useState(false);
  const [editLink, setEditLink] = useState<LinkItem | null>(null);
  const [form, setForm] = useState({ title: "", url: "", description: "", type: "link", folder: "" });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const getDomain = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };
  const typeIcon = (type: string | null) => type === "file" || type === "document" ? FileText : type === "folder" ? FolderOpen : Link2;

  const filtered = links.filter(l => {
    if (!search) return true;
    const s = search.toLowerCase();
    return l.title.toLowerCase().includes(s) || l.url.toLowerCase().includes(s) || (l.description || "").toLowerCase().includes(s);
  });

  const folders = [...new Set(links.map(l => l.folder).filter(Boolean))];
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const displayed = activeFolder ? filtered.filter(l => l.folder === activeFolder) : filtered;

  const openCreate = () => {
    setEditLink(null);
    setForm({ title: "", url: "", description: "", type: "link", folder: "" });
    setShowDialog(true);
  };

  const openEdit = (l: LinkItem) => {
    setEditLink(l);
    setForm({ title: l.title, url: l.url, description: l.description || "", type: l.type || "link", folder: l.folder || "" });
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return toast.error("Título obrigatório");
    const normalizedUrl = normalizeUrl(form.url);
    if (!normalizedUrl) return toast.error("URL obrigatória");
    if (!isValidUrl(normalizedUrl)) return toast.error("Informe um endereço válido");
    if (links.some((item) => item.id !== editLink?.id && item.url === normalizedUrl)) return toast.error("Este link já está salvo");
    setSaving(true);
    const payload = { title: form.title.trim(), url: normalizedUrl, description: form.description.trim() || null, type: form.type, folder: form.folder.trim() || null };
    const saved = editLink ? await update(editLink.id, payload) : await create(payload);
    setSaving(false);
    if (saved) setShowDialog(false);
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado!");
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">Biblioteca</p>
          <h1 className="page-title">Links e arquivos</h1>
          <p className="page-description">Centralize atalhos, documentos e pastas importantes.</p>
        </div>
        <button onClick={openCreate} className="action-primary">
          <Plus className="w-4 h-4" /> Novo link
        </button>
      </div>

      <div className="toolbar-panel">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input aria-label="Buscar links" type="text" placeholder="Buscar por nome, endereço ou descrição…" value={search} onChange={(e) => setSearch(e.target.value)} className="field h-10 pl-9" />
        </div>
        <span className="whitespace-nowrap text-xs text-muted-foreground">{displayed.length} resultado{displayed.length === 1 ? "" : "s"}</span>
      </div>

      {folders.length > 0 && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          <button onClick={() => setActiveFolder(null)} className={cn("px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors",
            !activeFolder ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          )}>Todos</button>
          {folders.map(f => (
            <button key={f} onClick={() => setActiveFolder(f!)} className={cn(
              "px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors",
              activeFolder === f ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            )}>{f}</button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-muted-foreground animate-pulse">Carregando...</div>
      ) : displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 rounded-full bg-secondary mb-4"><Link2 className="w-8 h-8 text-muted-foreground" /></div>
          <h2 className="text-lg font-semibold text-foreground mb-1">{search || activeFolder ? "Nenhum link encontrado" : "Nenhum link salvo"}</h2>
          <p className="text-sm text-muted-foreground max-w-sm">{search || activeFolder ? "Ajuste a busca ou selecione outra pasta." : "Salve links do Google Drive, Dropbox, Notion e outros."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map(l => (
            <div key={l.id} className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border hover:bg-card-hover transition-colors group">
              <div className="p-2 rounded-md bg-secondary">
                {(() => { const TypeIcon = typeIcon(l.type); return <TypeIcon className="h-4 w-4 text-muted-foreground" />; })()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">{l.title}</p>
                <p className="text-[10px] text-muted-foreground truncate">{getDomain(l.url)}{l.folder ? ` · ${l.folder}` : ""}</p>
              </div>
              <div className="flex gap-1">
                <a aria-label={`Abrir ${l.title}`} href={l.url} target="_blank" rel="noopener noreferrer" className="icon-button-sm"><ExternalLink className="w-3.5 h-3.5" /></a>
                <button aria-label={`Copiar ${l.title}`} onClick={() => void copyUrl(l.url)} className="icon-button-sm"><Copy className="w-3.5 h-3.5" /></button>
                <button aria-label={`Editar ${l.title}`} onClick={() => openEdit(l)} className="icon-button-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"><Edit2 className="w-3.5 h-3.5" /></button>
                <button aria-label={`Excluir ${l.title}`} onClick={() => setDeleteConfirm(l.id)} className="icon-button-sm text-destructive opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">{editLink ? "Editar" : "Novo"} Link</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <input aria-label="Título do link" type="text" placeholder="Título" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <input aria-label="Endereço do link" type="url" placeholder="exemplo.com ou https://…" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <input type="text" placeholder="Descrição (opcional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <div className="grid grid-cols-2 gap-3">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
                <option value="link">Link</option>
                <option value="file">Arquivo</option>
                <option value="folder">Pasta</option>
                <option value="document">Documento</option>
              </select>
              <input type="text" placeholder="Pasta (opcional)" value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })}
                className="h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <button onClick={() => void handleSave()} disabled={saving} className="action-primary w-full justify-center">
              <Save className="w-4 h-4 inline mr-2" />{saving ? "Salvando..." : editLink ? "Salvar" : "Criar"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Confirmar exclusão</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Tem certeza que deseja excluir este link?</p>
          <div className="dialog-actions">
            <button onClick={() => setDeleteConfirm(null)} className="action-secondary">Cancelar</button>
            <button onClick={() => { if (deleteConfirm) void remove(deleteConfirm).then((removed) => { if (removed) setDeleteConfirm(null); }); }} className="action-danger">Excluir</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LinksPage;
