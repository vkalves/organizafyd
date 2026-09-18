import { StickyNote, Plus, FolderOpen, Search, Trash2, Star, Pin, Save, ArrowLeft, X } from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RichTextEditor } from "@/components/notes/RichTextEditor";
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
  const [editNote, setEditNote] = useState<Note | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editFolderId, setEditFolderId] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [showTitleDialog, setShowTitleDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const autosaveRef = useRef<ReturnType<typeof setTimeout>>();

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

  const openEditor = (n: Note) => {
    setEditNote(n);
    setEditTitle(n.title);
    setEditContent(n.content || "");
    setEditFolderId(n.folder_id || "");
    setIsEditing(true);
  };

  const handleCreateNote = async () => {
    if (!newTitle.trim()) return toast.error("Título obrigatório");
    const note = await create({ title: newTitle.trim(), content: "", folder_id: activeFolder || null });
    if (note) {
      setShowTitleDialog(false);
      setNewTitle("");
      openEditor(note);
    }
  };

  const handleContentChange = useCallback((html: string) => {
    setEditContent(html);
    if (!editNote) return;
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(async () => {
      setSaving(true);
      await update(editNote.id, { content: html });
      setSaving(false);
    }, 1500);
  }, [editNote, update]);

  const handleSaveTitle = async () => {
    if (!editNote || !editTitle.trim()) return;
    await update(editNote.id, { title: editTitle, folder_id: editFolderId || null });
    toast.success("Nota salva!");
  };

  const closeEditor = () => {
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    if (editNote) {
      update(editNote.id, { content: editContent, title: editTitle, folder_id: editFolderId || null });
    }
    setIsEditing(false);
    setEditNote(null);
  };

  useEffect(() => {
    return () => { if (autosaveRef.current) clearTimeout(autosaveRef.current); };
  }, []);

  const togglePin = async (n: Note, e: React.MouseEvent) => { e.stopPropagation(); await update(n.id, { is_pinned: !n.is_pinned }); };
  const toggleFav = async (n: Note, e: React.MouseEvent) => { e.stopPropagation(); await update(n.id, { is_favorite: !n.is_favorite }); };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    await createFolder({ name: newFolderName.trim() });
    setNewFolderName("");
    setShowFolderDialog(false);
  };

  if (isEditing && editNote) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={closeEditor} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
          <div className="flex items-center gap-2">
            {saving && <span className="text-xs text-muted-foreground animate-pulse">Salvando...</span>}
            <button onClick={handleSaveTitle} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
              <Save className="w-3.5 h-3.5" /> Salvar
            </button>
          </div>
        </div>

        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleSaveTitle}
          className="w-full text-2xl font-bold bg-transparent text-foreground border-none focus:outline-none placeholder:text-muted-foreground"
          placeholder="Título da nota"
        />

        <select value={editFolderId} onChange={(e) => setEditFolderId(e.target.value)}
          className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
          <option value="">Sem pasta</option>
          {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>

        <RichTextEditor content={editContent} onChange={handleContentChange} />
      </div>
    );
  }

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
          <button onClick={() => { setNewTitle(""); setShowTitleDialog(true); }} className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
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
            <div key={n.id} className="bg-card border border-border rounded-lg p-4 hover:bg-card-hover transition-colors group cursor-pointer" onClick={() => openEditor(n)}>
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-medium text-foreground truncate flex-1">{n.title}</h3>
                <div className="flex gap-1 ml-2">
                  {n.is_pinned && <Pin className="w-3 h-3 text-foreground" />}
                  {n.is_favorite && <Star className="w-3 h-3 text-warning fill-warning" />}
                </div>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-3">{n.content ? n.content.replace(/<[^>]*>/g, "").slice(0, 150) : "Sem conteúdo"}</p>
              <div className="flex items-center justify-between mt-3">
                <span className="text-[10px] text-muted-foreground">{new Date(n.updated_at).toLocaleDateString("pt-BR")}</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={(e) => togglePin(n, e)} className="p-1 rounded hover:bg-accent"><Pin className={cn("w-3 h-3", n.is_pinned ? "text-foreground" : "text-muted-foreground")} /></button>
                  <button onClick={(e) => toggleFav(n, e)} className="p-1 rounded hover:bg-accent"><Star className={cn("w-3 h-3", n.is_favorite ? "text-warning fill-warning" : "text-muted-foreground")} /></button>
                  <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(n.id); }} className="p-1 rounded hover:bg-accent"><Trash2 className="w-3 h-3 text-destructive" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Title dialog for new note */}
      <Dialog open={showTitleDialog} onOpenChange={setShowTitleDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Nova Nota</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <input type="text" placeholder="Título da nota" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateNote()}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" autoFocus />
            <button onClick={handleCreateNote} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">Criar e Editar</button>
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
