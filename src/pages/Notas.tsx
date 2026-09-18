import {
  ArrowLeft,
  FolderOpen,
  Pin,
  Plus,
  Save,
  Search,
  Star,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RichTextEditor } from "@/components/notes/RichTextEditor";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";
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

type SaveState = "idle" | "saving" | "saved" | "error";

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const Notas = () => {
  const { data: notes, loading, create, update, remove } = useSupabaseCrud<Note>("notes", "updated_at");
  const { data: folders, create: createFolder, remove: removeFolder } = useSupabaseCrud<Folder>("folders");
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [search, setSearch] = useState("");
  const [editNote, setEditNote] = useState<Note | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editFolderId, setEditFolderId] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [showTitleDialog, setShowTitleDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const autosaveRef = useRef<ReturnType<typeof setTimeout>>();

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return notes
      .filter((note) => !activeFolder || note.folder_id === activeFolder)
      .filter((note) => !onlyFavorites || note.is_favorite)
      .filter((note) => {
        if (!term) return true;
        return `${note.title} ${stripHtml(note.content || "")}`.toLocaleLowerCase("pt-BR").includes(term);
      })
      .sort((a, b) => Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned)));
  }, [activeFolder, notes, onlyFavorites, search]);

  const openEditor = (note: Note) => {
    setEditNote(note);
    setEditTitle(note.title);
    setEditContent(note.content || "");
    setEditFolderId(note.folder_id || "");
    setSaveState("idle");
  };

  const persistNote = useCallback(async (updates: Partial<Note>) => {
    if (!editNote) return false;
    setSaveState("saving");
    const saved = await update(editNote.id, updates, { silent: true });
    setSaveState(saved ? "saved" : "error");
    return Boolean(saved);
  }, [editNote, update]);

  const handleContentChange = useCallback((html: string) => {
    setEditContent(html);
    setSaveState("idle");
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(() => {
      void persistNote({ content: html });
    }, 900);
  }, [persistNote]);

  const saveMetadata = async () => {
    if (!editTitle.trim()) {
      toast.error("Informe um título para a nota");
      return false;
    }
    return persistNote({
      title: editTitle.trim(),
      content: editContent,
      folder_id: editFolderId || null,
    });
  };

  const closeEditor = async () => {
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    const saved = await saveMetadata();
    if (!saved) return;
    setEditNote(null);
  };

  useEffect(() => () => {
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
  }, []);

  const handleCreateNote = async () => {
    const title = newTitle.trim();
    if (!title) return toast.error("Título obrigatório");
    const note = await create({ title, content: "", folder_id: activeFolder || null });
    if (!note) return;
    setShowTitleDialog(false);
    setNewTitle("");
    openEditor(note);
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return toast.error("Nome da pasta obrigatório");
    if (folders.some((folder) => folder.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
      return toast.error("Já existe uma pasta com esse nome");
    }
    const folder = await createFolder({ name });
    if (!folder) return;
    setActiveFolder(folder.id);
    setNewFolderName("");
    setShowFolderDialog(false);
  };

  const togglePin = async (note: Note, event: React.MouseEvent) => {
    event.stopPropagation();
    await update(note.id, { is_pinned: !note.is_pinned }, { silent: true });
  };

  const toggleFavorite = async (note: Note, event: React.MouseEvent) => {
    event.stopPropagation();
    await update(note.id, { is_favorite: !note.is_favorite }, { silent: true });
  };

  const confirmFolderDelete = async () => {
    if (!deleteFolderId) return;
    const removed = await removeFolder(deleteFolderId);
    if (removed && activeFolder === deleteFolderId) setActiveFolder(null);
    setDeleteFolderId(null);
  };

  if (editNote) {
    return (
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button onClick={() => void closeEditor()} className="action-ghost">
            <ArrowLeft className="h-4 w-4" /> Voltar para notas
          </button>
          <div className="flex items-center gap-3">
            <span className={cn(
              "text-xs",
              saveState === "error" ? "text-destructive" : "text-muted-foreground",
            )} aria-live="polite">
              {saveState === "saving" && "Salvando…"}
              {saveState === "saved" && "Alterações salvas"}
              {saveState === "error" && "Não foi possível salvar"}
            </span>
            <button onClick={() => void saveMetadata()} className="action-primary">
              <Save className="h-4 w-4" /> Salvar
            </button>
          </div>
        </div>

        <input
          aria-label="Título da nota"
          className="w-full border-none bg-transparent text-2xl font-bold text-foreground outline-none placeholder:text-muted-foreground sm:text-3xl"
          value={editTitle}
          onChange={(event) => {
            setEditTitle(event.target.value);
            setSaveState("idle");
          }}
          onBlur={() => void saveMetadata()}
          placeholder="Título da nota"
        />

        <select
          aria-label="Pasta da nota"
          value={editFolderId}
          onChange={(event) => {
            setEditFolderId(event.target.value);
            void persistNote({ folder_id: event.target.value || null });
          }}
          className="field h-10 max-w-xs"
        >
          <option value="">Sem pasta</option>
          {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>

        <RichTextEditor content={editContent} onChange={handleContentChange} />
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">Conhecimento</p>
          <h1 className="page-title">Notas</h1>
          <p className="page-description">Capture ideias, processos e informações importantes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowFolderDialog(true)} className="action-secondary">
            <FolderOpen className="h-4 w-4" /> Nova pasta
          </button>
          <button onClick={() => setShowTitleDialog(true)} className="action-primary">
            <Plus className="h-4 w-4" /> Nova nota
          </button>
        </div>
      </div>

      <div className="toolbar-panel">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Buscar nas notas"
            className="field h-10 pl-9"
            placeholder="Buscar por título ou conteúdo…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <button
          aria-pressed={onlyFavorites}
          onClick={() => setOnlyFavorites((current) => !current)}
          className={cn("filter-chip", onlyFavorites && "filter-chip-active")}
        >
          <Star className={cn("h-3.5 w-3.5", onlyFavorites && "fill-current")} /> Favoritas
        </button>
      </div>

      {folders.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Filtrar por pasta">
          <button onClick={() => setActiveFolder(null)} className={cn("filter-chip", !activeFolder && "filter-chip-active")}>Todas</button>
          {folders.map((folder) => (
            <div key={folder.id} className={cn("group flex items-center rounded-full border", activeFolder === folder.id ? "border-foreground/30 bg-foreground text-background" : "border-border bg-secondary text-muted-foreground")}>
              <button onClick={() => setActiveFolder(folder.id)} className="flex items-center gap-1.5 py-1.5 pl-3 pr-2 text-xs font-medium">
                <FolderOpen className="h-3.5 w-3.5" /> {folder.name}
              </button>
              <button
                aria-label={`Excluir pasta ${folder.name}`}
                onClick={() => setDeleteFolderId(folder.id)}
                className="mr-1 rounded-full p-1 opacity-60 transition-opacity hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="card-grid" aria-label="Carregando notas">
          {[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="h-40 animate-pulse rounded-xl border border-border bg-card" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon"><StickyNote className="h-7 w-7" /></span>
          <h2 className="text-base font-semibold">{search || onlyFavorites || activeFolder ? "Nenhuma nota encontrada" : "Sua primeira nota começa aqui"}</h2>
          <p>{search || onlyFavorites || activeFolder ? "Ajuste os filtros para encontrar outra nota." : "Crie uma nota para guardar ideias e informações importantes."}</p>
          {!search && !onlyFavorites && !activeFolder && <button onClick={() => setShowTitleDialog(true)} className="action-primary mt-2"><Plus className="h-4 w-4" /> Criar nota</button>}
        </div>
      ) : (
        <div className="card-grid">
          {filtered.map((note) => (
            <article
              key={note.id}
              role="button"
              tabIndex={0}
              onClick={() => openEditor(note)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") openEditor(note);
              }}
              className="group surface-card cursor-pointer p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{note.title}</h2>
                <div className="flex items-center gap-1">
                  <button aria-label={note.is_pinned ? "Desafixar nota" : "Fixar nota"} onClick={(event) => void togglePin(note, event)} className="icon-button-sm">
                    <Pin className={cn("h-3.5 w-3.5", note.is_pinned && "text-foreground")} />
                  </button>
                  <button aria-label={note.is_favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"} onClick={(event) => void toggleFavorite(note, event)} className="icon-button-sm">
                    <Star className={cn("h-3.5 w-3.5", note.is_favorite && "fill-warning text-warning")} />
                  </button>
                  <button aria-label="Excluir nota" onClick={(event) => { event.stopPropagation(); setDeleteNoteId(note.id); }} className="icon-button-sm text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <p className="line-clamp-3 min-h-12 text-xs leading-5 text-muted-foreground">{stripHtml(note.content || "") || "Sem conteúdo"}</p>
              <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{formatDate(note.updated_at)}</span>
                {note.folder_id && <span className="truncate">{folders.find((folder) => folder.id === note.folder_id)?.name}</span>}
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={showTitleDialog} onOpenChange={setShowTitleDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova nota</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <input autoFocus className="field" placeholder="Título da nota" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void handleCreateNote(); }} />
            <button onClick={() => void handleCreateNote()} className="action-primary w-full justify-center">Criar e editar</button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showFolderDialog} onOpenChange={setShowFolderDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova pasta</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <input autoFocus className="field" placeholder="Nome da pasta" value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void handleCreateFolder(); }} />
            <button onClick={() => void handleCreateFolder()} className="action-primary w-full justify-center">Criar pasta</button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteNoteId)} onOpenChange={() => setDeleteNoteId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Excluir nota?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Esta ação não poderá ser desfeita.</p>
          <div className="dialog-actions">
            <button onClick={() => setDeleteNoteId(null)} className="action-secondary">Cancelar</button>
            <button onClick={() => { if (deleteNoteId) void remove(deleteNoteId).then(() => setDeleteNoteId(null)); }} className="action-danger">Excluir</button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteFolderId)} onOpenChange={() => setDeleteFolderId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Excluir pasta?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">As notas serão mantidas e movidas para “Sem pasta”.</p>
          <div className="dialog-actions">
            <button onClick={() => setDeleteFolderId(null)} className="action-secondary">Cancelar</button>
            <button onClick={() => void confirmFolderDelete()} className="action-danger">Excluir pasta</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Notas;
