import { Link2, Plus, ExternalLink, Copy, Trash2, Edit2, Save } from "lucide-react";
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

const LinksPage = () => {
  const { data: links, loading, create, update, remove } = useSupabaseCrud<LinkItem>("links");
  const [showDialog, setShowDialog] = useState(false);
  const [editLink, setEditLink] = useState<LinkItem | null>(null);
  const [form, setForm] = useState({ title: "", url: "", description: "", type: "link", folder: "" });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const getDomain = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };

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
    if (!form.title.trim() || !form.url.trim()) return toast.error("Título e URL obrigatórios");
    const payload = { title: form.title, url: form.url, description: form.description || null, type: form.type, folder: form.folder || null };
    if (editLink) await update(editLink.id, payload);
    else await create(payload);
    setShowDialog(false);
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("Link copiado!");
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Links & Arquivos</h1>
          <p className="text-sm text-muted-foreground mt-1">Organize seus links externos</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" /> Novo Link
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground animate-pulse">Carregando...</div>
      ) : links.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 rounded-full bg-secondary mb-4"><Link2 className="w-8 h-8 text-muted-foreground" /></div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Nenhum link salvo</h2>
          <p className="text-sm text-muted-foreground max-w-sm">Salve links do Google Drive, Dropbox, Notion e outros.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {links.map(l => (
            <div key={l.id} className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border hover:bg-card-hover transition-colors group">
              <div className="p-2 rounded-md bg-secondary">
                <img src={`https://www.google.com/s2/favicons?domain=${getDomain(l.url)}&sz=32`} alt="" className="w-4 h-4" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">{l.title}</p>
                <p className="text-[10px] text-muted-foreground truncate">{getDomain(l.url)}</p>
              </div>
              <div className="flex gap-1">
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded hover:bg-accent"><ExternalLink className="w-3.5 h-3.5 text-muted-foreground" /></a>
                <button onClick={() => copyUrl(l.url)} className="p-1.5 rounded hover:bg-accent"><Copy className="w-3.5 h-3.5 text-muted-foreground" /></button>
                <button onClick={() => openEdit(l)} className="p-1.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100"><Edit2 className="w-3.5 h-3.5 text-muted-foreground" /></button>
                <button onClick={() => setDeleteConfirm(l.id)} className="p-1.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5 text-destructive" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">{editLink ? "Editar" : "Novo"} Link</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <input type="text" placeholder="Título" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <input type="url" placeholder="https://..." value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <input type="text" placeholder="Descrição (opcional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
              <option value="link">Link</option>
              <option value="file">Arquivo</option>
              <option value="folder">Pasta</option>
              <option value="document">Documento</option>
            </select>
            <button onClick={handleSave} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"><Save className="w-4 h-4 inline mr-2" />{editLink ? "Salvar" : "Criar"}</button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Confirmar exclusão</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Tem certeza que deseja excluir este link?</p>
          <div className="flex gap-2 justify-end mt-4">
            <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 rounded-md bg-secondary text-sm text-foreground">Cancelar</button>
            <button onClick={() => deleteConfirm && remove(deleteConfirm).then(() => setDeleteConfirm(null))} className="px-4 py-2 rounded-md bg-destructive text-destructive-foreground text-sm font-medium">Excluir</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LinksPage;
