import { StickyNote, Plus, FolderOpen, Search, Trash2, Star, Pin, Save, ArrowLeft, Archive, ArchiveRestore, Maximize2, Minimize2, Eye, Pencil } from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RichTextEditor } from "@/components/notes/RichTextEditor";
import { useAppLayout } from "@/contexts/AppLayoutContext";
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

const ARCHIVED_TAG = "__organizafy_archived__";

const Notas = () => {
  const { setMobileFocusMode } = useAppLayout();
  const { data: notes, loading, create, update, remove, refetch: refetchNotes } = useSupabaseCrud<Note>("notes", "updated_at");
  const { data: folders, create: createFolder, remove: removeFolder } = useSupabaseCrud<Folder>("folders");
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [editNote, setEditNote] = useState<Note | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [readOnly, setReadOnly] = useState(true);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editFolderId, setEditFolderId] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const folderBusyRef = useRef(false);
  const [showTitleDialog, setShowTitleDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [focusMode, setFocusMode] = useState(false);
  const [closing, setClosing] = useState(false);
  const autosaveRef = useRef<ReturnType<typeof setTimeout>>();
  const autosavePromiseRef = useRef<Promise<Note | null> | null>(null);
  const saveVersionRef = useRef(0);

  const filtered = notes.filter((n) => {
    const archived = n.tags?.includes(ARCHIVED_TAG) ?? false;
    if (showArchived ? !archived : archived) return false;
    if (!showArchived && activeFolder && n.folder_id !== activeFolder) return false;
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

  const openEditor = (n: Note, editable = false) => {
    setReadOnly(!editable);
    setEditNote(n);
    setEditTitle(n.title);
    setEditContent(n.content || "");
    setEditFolderId(n.folder_id || "");
    setSaveState("saved");
    setFocusMode(false);
    setIsEditing(true);
  };

  const handleCreateNote = async () => {
    if (!newTitle.trim()) return toast.error("Título obrigatório");
    const note = await create({ title: newTitle.trim(), content: "", folder_id: activeFolder || null });
    if (note) {
      setShowArchived(false);
      setShowTitleDialog(false);
      setNewTitle("");
      openEditor(note, true);
    }
  };

  const saveNote = useCallback(async (payload: Partial<Note>, notify = false) => {
    if (!editNote) return null;
    const version = ++saveVersionRef.current;
    setSaving(true);
    setSaveState("saving");
    const request = update(editNote.id, payload, { silent: !notify });
    autosavePromiseRef.current = request;

    try {
      const saved = await request;
      if (saveVersionRef.current === version) {
        if (saved) {
          setEditNote(saved);
          setSaveState("saved");
        } else {
          setSaveState("error");
        }
      }
      return saved;
    } finally {
      if (saveVersionRef.current === version) setSaving(false);
    }
  }, [editNote, update]);

  const scheduleAutosave = useCallback((overrides?: {
    title?: string;
    content?: string;
    folderId?: string;
  }) => {
    if (!editNote) return;

    const title = overrides?.title ?? editTitle;
    const content = overrides?.content ?? editContent;
    const folderId = overrides?.folderId ?? editFolderId;

    setSaveState("dirty");
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    if (!title.trim()) return;

    autosaveRef.current = setTimeout(() => {
      void saveNote({
        title: title.trim(),
        content,
        folder_id: folderId || null,
      });
    }, 850);
  }, [editContent, editFolderId, editNote, editTitle, saveNote]);

  const handleContentChange = useCallback((html: string) => {
    setEditContent(html);
    scheduleAutosave({ content: html });
  }, [scheduleAutosave]);

  const persistCurrentNote = useCallback(async (notify = false) => {
    if (!editNote) return null;
    if (!editTitle.trim()) {
      toast.error("O título da nota não pode ficar vazio");
      return null;
    }
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    if (autosavePromiseRef.current) await autosavePromiseRef.current;
    return saveNote({
      title: editTitle.trim(),
      content: editContent,
      folder_id: editFolderId || null,
    }, notify);
  }, [editContent, editFolderId, editNote, editTitle, saveNote]);

  const handleSave = async () => {
    await persistCurrentNote(true);
  };

  const closeEditor = async () => {
    if (closing) return;
    setClosing(true);
    try {
      if (!readOnly || saveState !== "saved") {
        const saved = await persistCurrentNote(false);
        if (!saved) return;
      }
      setFocusMode(false);
      setIsEditing(false);
      setEditNote(null);
    } finally {
      setClosing(false);
    }
  };

  useEffect(() => {
    return () => { if (autosaveRef.current) clearTimeout(autosaveRef.current); };
  }, []);

  useEffect(() => {
    setMobileFocusMode(isEditing);
    return () => setMobileFocusMode(false);
  }, [isEditing, setMobileFocusMode]);

  useEffect(() => {
    if (!focusMode) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [focusMode]);

  useEffect(() => {
    if (!isEditing) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!readOnly) void persistCurrentNote(false);
      }

      if (event.key === "Escape" && focusMode) {
        setFocusMode(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusMode, isEditing, persistCurrentNote, readOnly]);

  const togglePin = async (n: Note, e: React.MouseEvent) => { e.stopPropagation(); await update(n.id, { is_pinned: !n.is_pinned }); };
  const toggleFav = async (n: Note, e: React.MouseEvent) => { e.stopPropagation(); await update(n.id, { is_favorite: !n.is_favorite }); };

  const toggleCurrentPin = async () => {
    if (!editNote) return;
    const saved = await update(editNote.id, { is_pinned: !editNote.is_pinned }, { silent: true });
    if (saved) setEditNote(saved);
  };

  const toggleCurrentFavorite = async () => {
    if (!editNote) return;
    const saved = await update(editNote.id, { is_favorite: !editNote.is_favorite }, { silent: true });
    if (saved) setEditNote(saved);
  };

  const handleToggleArchive = async () => {
    if (!editNote) return;
    if (!editTitle.trim()) return toast.error("O título da nota não pode ficar vazio");

    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    if (autosavePromiseRef.current) await autosavePromiseRef.current;

    const archived = editNote.tags?.includes(ARCHIVED_TAG) ?? false;
    const tags = (editNote.tags || []).filter((tag) => tag !== ARCHIVED_TAG);
    if (!archived) tags.push(ARCHIVED_TAG);

    const saved = await saveNote({
      title: editTitle.trim(),
      content: editContent,
      folder_id: editFolderId || null,
      tags,
    });

    if (!saved) return;
    toast.success(archived ? "Nota desarquivada" : "Nota arquivada");
    setFocusMode(false);
    setIsEditing(false);
    setEditNote(null);
  };

  const handleDeleteNote = async () => {
    if (!deleteConfirm) return;
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    if (autosavePromiseRef.current) await autosavePromiseRef.current;

    const id = deleteConfirm;
    const deleted = await remove(id);
    if (!deleted) return;

    setDeleteConfirm(null);
    if (editNote?.id === id) {
      setFocusMode(false);
      setIsEditing(false);
      setEditNote(null);
    }
  };

  const openFolderDialog = () => {
    setFocusMode(false);
    setNewFolderName("");
    setShowFolderDialog(true);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || folderBusyRef.current) return;
    folderBusyRef.current = true;
    setFolderBusy(true);
    try {
      const folder = await createFolder({ name: newFolderName.trim() });
      if (!folder) return;
      if (isEditing) {
        setEditFolderId(folder.id);
        scheduleAutosave({ folderId: folder.id });
      }
      setNewFolderName("");
      setShowFolderDialog(false);
    } finally {
      folderBusyRef.current = false;
      setFolderBusy(false);
    }
  };

  const handleDeleteFolder = async () => {
    if (!folderToDelete || folderBusyRef.current) return;
    folderBusyRef.current = true;
    setFolderBusy(true);
    try {
      const id = folderToDelete.id;
      if (!(await removeFolder(id))) return;
      if (activeFolder === id) setActiveFolder(null);
      if (editFolderId === id) setEditFolderId("");
      if (editNote?.folder_id === id) setEditNote({ ...editNote, folder_id: null });
      setFolderToDelete(null);
      await refetchNotes();
    } finally {
      folderBusyRef.current = false;
      setFolderBusy(false);
    }
  };

  const noteDeleteDialog = (
    <Dialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
      <DialogContent className="bg-card border-border">
        <DialogHeader><DialogTitle className="text-foreground">Confirmar exclusão</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Tem certeza que deseja excluir esta nota?</p>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button onClick={() => setDeleteConfirm(null)} className="min-h-11 rounded-md bg-secondary px-4 py-2 text-sm text-foreground">Cancelar</button>
          <button onClick={() => void handleDeleteNote()} className="min-h-11 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground">Excluir nota</button>
        </div>
      </DialogContent>
    </Dialog>
  );

  const folderDialogs = (
    <>
      <Dialog open={showFolderDialog} onOpenChange={open => { if (!folderBusy) setShowFolderDialog(open); }}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Nova Pasta</DialogTitle></DialogHeader>
          <form onSubmit={e => { e.preventDefault(); void handleCreateFolder(); }} className="space-y-4">
            <input type="text" aria-label="Nome da pasta" placeholder="Nome da pasta" value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)} disabled={folderBusy} autoFocus
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <button type="submit" disabled={folderBusy || !newFolderName.trim()} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {folderBusy ? "Criando..." : "Criar Pasta"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!folderToDelete} onOpenChange={open => { if (!open && !folderBusy) setFolderToDelete(null); }}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Excluir pasta</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Excluir a pasta “{folderToDelete?.name}”? As notas serão mantidas e ficarão sem pasta.</p>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button disabled={folderBusy} onClick={() => setFolderToDelete(null)} className="min-h-11 rounded-md bg-secondary px-4 py-2 text-sm text-foreground">Cancelar</button>
            <button disabled={folderBusy} onClick={handleDeleteFolder} className="min-h-11 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50">
              {folderBusy ? "Excluindo..." : "Excluir pasta"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );

  if (isEditing && editNote) {
    const saveLabel =
      saveState === "saving"
        ? "Salvando..."
        : saveState === "dirty"
          ? "Alterações..."
          : saveState === "error"
            ? "Erro ao salvar"
            : "Salvo";

    return (
      <div
        className={cn(
          "flex min-h-0 flex-col bg-background",
          focusMode
            ? "fixed inset-0 z-[60] h-[100dvh] w-screen"
            : "h-full lg:mx-auto lg:h-[calc(100dvh-9rem)] lg:max-w-4xl lg:gap-4",
        )}
      >
        <div className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2",
          focusMode ? "hidden" : "lg:border-0 lg:px-0 lg:py-0",
        )}>
          <button
            type="button"
            disabled={closing}
            onClick={() => void closeEditor()}
            className="flex h-10 shrink-0 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label="Voltar para a lista de notas"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden min-[390px]:inline">Voltar</span>
          </button>

          <div className="flex min-w-0 items-center justify-end gap-1">
            <span
              className={cn(
                "mr-1 hidden truncate text-[11px] sm:inline",
                saveState === "error" ? "text-destructive" : "text-muted-foreground",
                saveState === "saving" && "animate-pulse",
              )}
              aria-live="polite"
            >
              {saveLabel}
            </span>

            <button
              type="button"
              disabled={readOnly}
              onClick={() => void toggleCurrentPin()}
              title={editNote.is_pinned ? "Desafixar nota" : "Fixar nota"}
              aria-label={editNote.is_pinned ? "Desafixar nota" : "Fixar nota"}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent",
                editNote.is_pinned ? "bg-accent text-foreground" : "text-muted-foreground",
              )}
            >
              <Pin className="h-4 w-4" />
            </button>

            <button
              type="button"
              disabled={readOnly}
              onClick={() => void toggleCurrentFavorite()}
              title={editNote.is_favorite ? "Remover dos favoritos" : "Favoritar nota"}
              aria-label={editNote.is_favorite ? "Remover dos favoritos" : "Favoritar nota"}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent",
                editNote.is_favorite ? "bg-accent text-warning" : "text-muted-foreground",
              )}
            >
              <Star className={cn("h-4 w-4", editNote.is_favorite && "fill-warning")} />
            </button>

            <button
              type="button"
              onClick={() => setFocusMode((active) => !active)}
              title={focusMode ? "Sair do modo foco · Esc" : "Modo foco"}
              aria-label={focusMode ? "Sair do modo foco" : "Ativar modo foco"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>

            <button
              type="button"
              disabled={readOnly || saving || closing}
              onClick={() => void handleToggleArchive()}
              title={editNote.tags?.includes(ARCHIVED_TAG) ? "Desarquivar nota" : "Arquivar nota"}
              aria-label={editNote.tags?.includes(ARCHIVED_TAG) ? "Desarquivar nota" : "Arquivar nota"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {editNote.tags?.includes(ARCHIVED_TAG)
                ? <ArchiveRestore className="h-4 w-4" />
                : <Archive className="h-4 w-4" />}
            </button>

            <button
              type="button"
              disabled={readOnly || saving || closing}
              onClick={() => {
                setFocusMode(false);
                setDeleteConfirm(editNote.id);
              }}
              title="Excluir nota"
              aria-label="Excluir nota"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>

            <button
              type="button"
              disabled={readOnly || saving || closing || !editTitle.trim()}
              onClick={() => void handleSave()}
              title="Salvar · Ctrl+S"
              className="ml-1 flex h-9 shrink-0 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span className="hidden sm:inline">Salvar</span>
            </button>
          </div>
        </div>

        <div className={cn(
          "flex min-h-0 flex-1 flex-col",
          focusMode ? "p-0" : "safe-bottom-padding gap-3 px-3 pt-3 sm:px-4 lg:p-0",
        )}>
          <div className={cn("shrink-0 flex-col gap-3", focusMode ? "hidden" : "flex")}>
          <div className="inline-flex w-fit shrink-0 items-center gap-1" role="group" aria-label="Modo da nota">
            <button
              type="button"
              aria-pressed={readOnly}
              disabled={switchingMode || closing}
              onClick={async () => {
                if (readOnly) return;
                setSwitchingMode(true);
                try {
                  if (await persistCurrentNote(false)) setReadOnly(true);
                } finally {
                  setSwitchingMode(false);
                }
              }}
              className={cn("flex h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs transition-colors outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-muted-foreground/50 disabled:opacity-50", readOnly ? "bg-accent text-foreground" : "text-muted-foreground")}
            >
              <Eye className="h-3.5 w-3.5" /> {switchingMode ? "Salvando..." : "Visualizar"}
            </button>
            <button
              type="button"
              aria-pressed={!readOnly}
              disabled={switchingMode || closing}
              onClick={() => setReadOnly(false)}
              className={cn("flex h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs transition-colors outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-muted-foreground/50 disabled:opacity-50", !readOnly ? "bg-accent text-foreground" : "text-muted-foreground")}
            >
              <Pencil className="h-3.5 w-3.5" /> Editar
            </button>
          </div>
          <div className="shrink-0">
            <input
              readOnly={readOnly || switchingMode}
              type="text"
              value={editTitle}
              onChange={(event) => {
                const value = event.target.value;
                setEditTitle(value);
                scheduleAutosave({ title: value });
              }}
              className="w-full border-none bg-transparent text-xl font-bold text-foreground placeholder:text-muted-foreground focus:outline-none sm:text-2xl"
              placeholder="Título da nota"
              aria-label="Título da nota"
            />
            <p className="mt-1 text-[10px] text-muted-foreground/65">
              {readOnly ? "Somente leitura · clique em Editar para alterar" : `${saveLabel} · Ctrl+S salva imediatamente`}
            </p>
          </div>

          {!readOnly && <div className="scrollbar-none flex min-w-0 shrink-0 items-center gap-2 overflow-x-auto">
            <select
              aria-label="Pasta da nota"
              value={editFolderId}
              onChange={(event) => {
                const value = event.target.value;
                setEditFolderId(value);
                scheduleAutosave({ folderId: value });
              }}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-secondary px-3 text-sm text-foreground focus:outline-none sm:flex-none"
            >
              <option value="">Sem pasta</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={openFolderDialog}
              className="flex h-9 shrink-0 items-center gap-2 rounded-md bg-secondary px-3 text-sm text-foreground transition-colors hover:bg-accent"
            >
              <Plus className="h-4 w-4" /> Nova pasta
            </button>

            {editFolderId && (
              <button
                type="button"
                aria-label="Excluir pasta selecionada"
                title="Excluir pasta selecionada"
                onClick={() => {
                  setFocusMode(false);
                  setFolderToDelete(folders.find((folder) => folder.id === editFolderId) || null);
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-destructive transition-colors hover:bg-accent"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>}

          </div>

          <RichTextEditor
            readOnly={readOnly || switchingMode}
            content={editContent}
            onChange={handleContentChange}
            className={cn("min-h-0 flex-1", focusMode && "rounded-none border-0")}
          />
        </div>

        {focusMode && (
          <button
            type="button"
            onClick={() => setFocusMode(false)}
            title="Minimizar · Esc"
            aria-label="Minimizar nota"
            className="fixed bottom-12 right-4 z-[61] flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        )}
        {folderDialogs}
        {noteDeleteDialog}
      </div>
    );
  }

  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Notas</h1>
          <p className="text-sm text-muted-foreground mt-1">Suas ideias e anotações</p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <button type="button" onClick={openFolderDialog} className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent sm:min-h-0">
            <FolderOpen className="h-4 w-4" /> Pasta
          </button>
          <button type="button" onClick={() => { setNewTitle(""); setShowTitleDialog(true); }} className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:min-h-0">
            <Plus className="h-4 w-4" /> Nova Nota
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="text" placeholder="Buscar nas notas..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full h-10 pl-9 pr-4 rounded-md bg-secondary border-none text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
      </div>

      <div className="scrollbar-none -mx-4 flex min-w-0 gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <button onClick={() => { setShowArchived(false); setActiveFolder(null); }} className={cn("px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors",
          !showArchived && !activeFolder ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
        )}>Todas</button>
        <button onClick={() => { setShowArchived(true); setActiveFolder(null); }} className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors",
          showArchived ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
        )}>
          <Archive className="w-3.5 h-3.5" /> Arquivadas
        </button>
        {folders.map((f) => (
          <div key={f.id} className="group/folder flex items-center shrink-0">
          <button onClick={() => { setShowArchived(false); setActiveFolder(f.id); }} className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors",
            activeFolder === f.id ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          )}>
            <FolderOpen className="w-3.5 h-3.5" /> {f.name}
          </button>
          <button aria-label={`Excluir pasta: ${f.name}`} title="Excluir pasta" onClick={() => setFolderToDelete(f)} className="pointer-events-none p-2 rounded-md text-muted-foreground opacity-0 transition-all hover:bg-accent hover:text-destructive group-hover/folder:pointer-events-auto group-hover/folder:opacity-100 group-focus-within/folder:pointer-events-auto group-focus-within/folder:opacity-100">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground animate-pulse">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 rounded-full bg-secondary mb-4">
            {showArchived ? <Archive className="w-8 h-8 text-muted-foreground" /> : <StickyNote className="w-8 h-8 text-muted-foreground" />}
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-1">{showArchived ? "Nenhuma nota arquivada" : "Nenhuma nota"}</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            {showArchived ? "As notas que você arquivar aparecerão aqui." : "Crie notas para organizar suas ideias."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((n) => (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              className="group cursor-pointer rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => openEditor(n)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openEditor(n);
                }
              }}
            >
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
                <div className="flex gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <button aria-label={n.is_pinned ? "Desafixar nota" : "Fixar nota"} onClick={(e) => togglePin(n, e)} className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent sm:h-7 sm:w-7"><Pin className={cn("h-3.5 w-3.5", n.is_pinned ? "text-foreground" : "text-muted-foreground")} /></button>
                  <button aria-label={n.is_favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"} onClick={(e) => toggleFav(n, e)} className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent sm:h-7 sm:w-7"><Star className={cn("h-3.5 w-3.5", n.is_favorite ? "fill-warning text-warning" : "text-muted-foreground")} /></button>
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

      {folderDialogs}

      {noteDeleteDialog}
    </div>
  );
};

export default Notas;
