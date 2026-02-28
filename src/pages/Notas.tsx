import { StickyNote, Plus, FolderOpen, Search, Trash2, Edit2, Star, Pin, Save, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

interface Note {
  id: string;
  title: string;
  content: string | null;
  folder_id: string | null;
  is_pinned: boolean | null;
  is_favorite: boolean | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

interface Folder {
  id: string;
  name: string;
  created_at: string;
}

const Notas = () => {
  const { data: notes, loading, create, update, remove } = useSupabaseCrud<Note>("notes", "updated_at");
  const { data: folders, create: createFolder, remove: removeFolder } = useSupabaseCrud<Folder>("folders");
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editNote, setEditNote] = useState<Note | null>(null);
  const [form, setForm] = useState({ title: "", content: "", folder_id: "" });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [showFolderDialog, setShowFolderDialog] = useState(false);

  const filtered = notes.filter((n) => {
    if (activeFolder && n.folder_id !== activeFolder) return false;
    if (search) {
      const s = search.toLowerCase();
      return n.title.toLowerCase().includes(s) || (n.content || "").toLowerCase().includes(s);
    }
    return true;
  }).sort((a, b) => {
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    return 0;
  });

  const openCreate = () => {
    setEditNote(null);
    setForm({ title: "", content: "", folder_id: activeFolder || "" });
    setShowDialog(true);
  };

  const openEdit = (n: Note) => {
    setEditNote(n);
    setForm({ title: n.title, content: n.content || "", folder_id: n.folder_id || "" });
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return toast.error("Título obrigatório");
    const payload = { title: form.title, content: form.content, folder_id: form.folder_id || null };
    if (editNote) await update(editNote.id, payload);
    else await create(payload);
    setShowDialog(false);
  };

  const togglePin = async (n: Note) => await update(n.id, { is_pinned: !n.is_pinned });
  const toggleFav = async (n: Note) => await update(n.id, { is_favorite: !n.is_favorite });

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    await createFolder({ name: newFolderName.trim() });
    setNewFolderName("");
    setShowFolderDialog(false);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Notas</h1>
          <p className="text-sm text-muted-foreground mt-1">Suas ideias e anotações</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowFolderDialog(true)} className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary text-sm text-foreground hover:bg-accent transition-colors">
            <FolderOpen className="w-4 h-4" /> Pasta
          </button>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" /> Nova Nota
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="text" placeholder="Buscar nas notas..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full h-10 pl-9 pr-4 rounded-md bg-secondary border-none text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        <button onClick={() => setActiveFolder(null)} className={cn("px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors",
          !activeFolder ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
        )}>Todas</button>
        {folders.map((f) => (
          <button key={f.id} onClick={() => setActiveFolder(f.id)} className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors",
            activeFolder === f.id ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          )}>
            <FolderOpen className="w-3.5 h-3.5" /> {f.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground animate-pulse">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 rounded-full bg-secondary mb-4"><StickyNote className="w-8 h-8 text-muted-foreground" /></div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Nenhuma nota</h2>
          <p className="text-sm text-muted-foreground max-w-sm">Crie notas para organizar suas ideias.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((n) => (
            <div key={n.id} className="bg-card border border-border rounded-lg p-4 hover:bg-card-hover transition-colors group cursor-pointer" onClick={() => openEdit(n)}>
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-medium text-foreground truncate flex-1">{n.title}</h3>
                <div className="flex gap-1 ml-2">
                  {n.is_pinned && <Pin className="w-3 h-3 text-foreground" />}
                  {n.is_favorite && <Star className="w-3 h-3 text-warning fill-warning" />}
                </div>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-3">{n.content || "Sem conteúdo"}</p>
              <div className="flex items-center justify-between mt-3">
                <span className="text-[10px] text-muted-foreground">{new Date(n.updated_at).toLocaleDateString("pt-BR")}</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => togglePin(n)} className="p-1 rounded hover:bg-accent"><Pin className={cn("w-3 h-3", n.is_pinned ? "text-foreground" : "text-muted-foreground")} /></button>
                  <button onClick={() => toggleFav(n)} className="p-1 rounded hover:bg-accent"><Star className={cn("w-3 h-3", n.is_favorite ? "text-warning fill-warning" : "text-muted-foreground")} /></button>
                  <button onClick={() => setDeleteConfirm(n.id)} className="p-1 rounded hover:bg-accent"><Trash2 className="w-3 h-3 text-destructive" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-card border-border max-w-2xl">
          <DialogHeader><DialogTitle className="text-foreground">{editNote ? "Editar Nota" : "Nova Nota"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <input type="text" placeholder="Título" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <select value={form.folder_id} onChange={(e) => setForm({ ...form, folder_id: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
              <option value="">Sem pasta</option>
              {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <textarea placeholder="Escreva sua nota..." value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
              className="w-full h-64 px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
            <button onClick={handleSave} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
              <Save className="w-4 h-4 inline mr-2" />{editNote ? "Salvar" : "Criar"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showFolderDialog} onOpenChange={setShowFolderDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Nova Pasta</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <input type="text" placeholder="Nome da pasta" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <button onClick={handleCreateFolder} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">Criar Pasta</button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Confirmar exclusão</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Tem certeza que deseja excluir esta nota?</p>
          <div className="flex gap-2 justify-end mt-4">
            <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 rounded-md bg-secondary text-sm text-foreground">Cancelar</button>
            <button onClick={() => deleteConfirm && remove(deleteConfirm).then(() => setDeleteConfirm(null))} className="px-4 py-2 rounded-md bg-destructive text-destructive-foreground text-sm font-medium">Excluir</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Notas;
