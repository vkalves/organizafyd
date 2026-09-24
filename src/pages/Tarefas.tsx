import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  Clock,
  Copy,
  ListChecks,
  Maximize2,
  Minimize2,
  Plus,
  Save,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Subtasks, type Subtask } from "@/components/tasks/Subtasks";

const priorities = [
  { value: "low", label: "Baixa", color: "text-muted-foreground", dot: "bg-muted-foreground/60" },
  { value: "medium", label: "Média", color: "text-warning", dot: "bg-warning" },
  { value: "high", label: "Alta", color: "text-destructive", dot: "bg-destructive" },
];

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: string | null;
  status: string | null;
  due_date: string | null;
  is_fixed_daily: boolean | null;
  tags: string[] | null;
  checklist: Subtask[] | null;
  completed_at: string | null;
  created_at: string;
}

type TaskForm = {
  title: string;
  description: string;
  priority: string;
  due_date: string;
  is_fixed_daily: boolean;
};

type SaveState = "saved" | "dirty" | "saving" | "error";

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function addDays(base: string, days: number) {
  const [year, month, day] = base.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function cloneChecklist(items: Subtask[]) {
  return items.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    done: false,
  }));
}

const Tarefas = () => {
  const today = dateKey();
  const tomorrow = addDays(today, 1);

  const [activeView, setActiveView] = useState("Todas");
  const { data: tasks, loading, create, update, remove } = useSupabaseCrud<Task>("tasks");
  const [showDialog, setShowDialog] = useState(false);
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickNoDeadline, setQuickNoDeadline] = useState(false);
  const [quickPriority, setQuickPriority] = useState("medium");
  const [form, setForm] = useState<TaskForm>({
    title: "",
    description: "",
    priority: "medium",
    due_date: today,
    is_fixed_daily: false,
  });
  const [checklist, setChecklist] = useState<Subtask[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const autosaveRef = useRef<ReturnType<typeof setTimeout>>();
  const autosavePromiseRef = useRef<Promise<Task | null> | null>(null);
  const saveVersionRef = useRef(0);

  const counts = useMemo(() => {
    const pending = tasks.filter((task) => task.status !== "done");
    return {
      Todas: tasks.length,
      Hoje: pending.filter((task) => task.due_date === today).length,
      "Sem prazo": pending.filter((task) => !task.due_date).length,
      Prioridade: pending.filter((task) => task.priority === "high").length,
      Concluídas: tasks.filter((task) => task.status === "done").length,
    };
  }, [tasks, today]);

  const views = ["Hoje", "Sem prazo", "Prioridade", "Concluídas", "Todas"];

  const filtered = useMemo(() => {
    return tasks
      .filter((task) => {
        if (activeView === "Hoje") return task.due_date === today && task.status !== "done";
        if (activeView === "Prioridade") return task.priority === "high" && task.status !== "done";
        if (activeView === "Concluídas") return task.status === "done";
        if (activeView === "Sem prazo") return !task.due_date && task.status !== "done";
        return true;
      })
      .sort((a, b) => {
        if (a.status === "done" && b.status !== "done") return 1;
        if (a.status !== "done" && b.status === "done") return -1;

        const aOverdue = !!a.due_date && a.due_date < today ? 1 : 0;
        const bOverdue = !!b.due_date && b.due_date < today ? 1 : 0;
        if (aOverdue !== bOverdue) return bOverdue - aOverdue;

        const priorityOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
        const diff =
          (priorityOrder[b.priority || "low"] || 0) -
          (priorityOrder[a.priority || "low"] || 0);
        if (diff) return diff;

        if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
        if (a.due_date) return -1;
        if (b.due_date) return 1;
        return b.created_at.localeCompare(a.created_at);
      });
  }, [activeView, tasks, today]);

  const editorProgress = useMemo(() => {
    if (!checklist.length) return 0;
    return Math.round((checklist.filter((item) => item.done).length / checklist.length) * 100);
  }, [checklist]);

  const buildPayload = useCallback((
    nextForm = form,
    nextChecklist = checklist,
    nextTags = tags,
  ) => ({
    title: nextForm.title.trim(),
    description: nextForm.description.trim(),
    priority: nextForm.priority,
    due_date: nextForm.due_date || null,
    is_fixed_daily: nextForm.is_fixed_daily,
    checklist: nextChecklist,
    tags: nextTags,
  }), [checklist, form, tags]);

  const saveExisting = useCallback(async (
    nextForm = form,
    nextChecklist = checklist,
    nextTags = tags,
    notify = false,
  ) => {
    if (!editTask) return null;
    if (!nextForm.title.trim()) return null;

    const version = ++saveVersionRef.current;
    setSaving(true);
    setSaveState("saving");

    const request = update(
      editTask.id,
      buildPayload(nextForm, nextChecklist, nextTags),
      { silent: !notify },
    );
    autosavePromiseRef.current = request;

    try {
      const saved = await request;
      if (saveVersionRef.current === version) {
        if (saved) {
          setEditTask(saved);
          setSaveState("saved");
        } else {
          setSaveState("error");
        }
      }
      return saved;
    } finally {
      if (saveVersionRef.current === version) setSaving(false);
    }
  }, [buildPayload, checklist, editTask, form, tags, update]);

  const scheduleAutosave = useCallback((
    nextForm = form,
    nextChecklist = checklist,
    nextTags = tags,
  ) => {
    if (!editTask) return;
    setSaveState("dirty");
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    if (!nextForm.title.trim()) return;

    autosaveRef.current = setTimeout(() => {
      void saveExisting(nextForm, nextChecklist, nextTags);
    }, 850);
  }, [checklist, editTask, form, saveExisting, tags]);

  const setFormAndAutosave = (next: TaskForm) => {
    setForm(next);
    scheduleAutosave(next, checklist, tags);
  };

  const handleQuickAdd = async () => {
    if (!quickTitle.trim()) return;

    const saved = await create({
      title: quickTitle.trim(),
      due_date: quickNoDeadline ? null : today,
      priority: quickPriority,
      status: "todo",
      checklist: [],
      tags: [],
    });

    if (saved) {
      setQuickTitle("");
      toast.success("Tarefa adicionada");
    }
  };

  const openCreate = () => {
    setEditTask(null);
    setForm({
      title: "",
      description: "",
      priority: "medium",
      due_date: today,
      is_fixed_daily: false,
    });
    setChecklist([]);
    setTags([]);
    setTagInput("");
    setSaveState("saved");
    setEditorFullscreen(false);
    setShowDialog(true);
  };

  const openEdit = (task: Task) => {
    setEditTask(task);
    setForm({
      title: task.title,
      description: task.description || "",
      priority: task.priority || "medium",
      due_date: task.due_date || "",
      is_fixed_daily: task.is_fixed_daily || false,
    });
    setChecklist((task.checklist as Subtask[]) || []);
    setTags(task.tags || []);
    setTagInput("");
    setSaveState("saved");
    setEditorFullscreen(false);
    setShowDialog(true);
  };

  const persistEditor = useCallback(async (notify = false) => {
    if (!form.title.trim()) {
      toast.error("Título obrigatório");
      return null;
    }

    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    if (autosavePromiseRef.current) await autosavePromiseRef.current;

    if (editTask) {
      return saveExisting(form, checklist, tags, notify);
    }

    setSaving(true);
    setSaveState("saving");
    try {
      const saved = await create({
        ...buildPayload(form, checklist, tags),
        status: "todo",
        completed_at: null,
      });

      if (saved) {
        setEditTask(saved);
        setSaveState("saved");
        if (notify) toast.success("Tarefa criada");
      } else {
        setSaveState("error");
      }
      return saved;
    } finally {
      setSaving(false);
    }
  }, [buildPayload, checklist, create, editTask, form, saveExisting, tags]);

  const closeEditor = async () => {
    if (saving) return;

    if (editTask && saveState !== "saved") {
      const saved = await persistEditor(false);
      if (!saved) return;
    }

    setEditorFullscreen(false);
    setShowDialog(false);
  };

  const toggleStatus = async (task: Task) => {
    const newStatus = task.status === "done" ? "todo" : "done";
    const saved = await update(task.id, {
      status: newStatus,
      completed_at: newStatus === "done" ? new Date().toISOString() : null,
    }, { silent: true });

    if (saved && editTask?.id === task.id) setEditTask(saved);
  };

  const toggleEditorStatus = async () => {
    if (!editTask) {
      const saved = await persistEditor(false);
      if (!saved) return;
      const newStatus = "done";
      const updated = await update(saved.id, {
        status: newStatus,
        completed_at: new Date().toISOString(),
      }, { silent: true });
      if (updated) setEditTask(updated);
      return;
    }

    await toggleStatus(editTask);
  };

  const duplicateTask = async () => {
    if (!form.title.trim()) return toast.error("Título obrigatório");

    const duplicated = await create({
      ...buildPayload(form, cloneChecklist(checklist), tags),
      title: form.title.trim() + " (cópia)",
      status: "todo",
      completed_at: null,
    });

    if (!duplicated) return;
    toast.success("Tarefa duplicada");
    openEdit(duplicated);
  };

  const handleDelete = async (id: string) => {
    const deleted = await remove(id);
    if (!deleted) return;

    setDeleteConfirm(null);
    if (editTask?.id === id) {
      setEditorFullscreen(false);
      setShowDialog(false);
      setEditTask(null);
    }
  };

  const handleChecklistChange = (items: Subtask[]) => {
    setChecklist(items);
    scheduleAutosave(form, items, tags);
    return true;
  };

  const addTag = () => {
    const value = tagInput.trim().replace(/^#/, "");
    if (!value) return;
    if (tags.some((tag) => tag.toLowerCase() === value.toLowerCase())) {
      setTagInput("");
      return;
    }
    const next = [...tags, value];
    setTags(next);
    setTagInput("");
    scheduleAutosave(form, checklist, next);
  };

  const removeTag = (tag: string) => {
    const next = tags.filter((item) => item !== tag);
    setTags(next);
    scheduleAutosave(form, checklist, next);
  };

  const isOverdue = (task: Task) =>
    !!task.due_date && task.due_date < today && task.status !== "done";

  const checklistProgress = (task: Task) => {
    const items = (task.checklist as Subtask[]) || [];
    if (!items.length) return null;
    const done = items.filter((item) => item.done).length;
    return { done, total: items.length, percent: Math.round((done / items.length) * 100) };
  };

  useEffect(() => {
    if (!showDialog) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void persistEditor(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [persistEditor, showDialog]);

  useEffect(() => {
    return () => {
      if (autosaveRef.current) clearTimeout(autosaveRef.current);
    };
  }, []);

  const saveLabel =
    saveState === "saving"
      ? "Salvando..."
      : saveState === "dirty"
        ? "Alterações..."
        : saveState === "error"
          ? "Erro ao salvar"
          : "Salvo";

  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Tarefas</h1>
          <p className="mt-1 text-sm text-muted-foreground">Organize seu dia e suas metas</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:min-h-0 sm:w-auto"
        >
          <Plus className="h-4 w-4" /> Nova tarefa
        </button>
      </div>

      <div className="scrollbar-none -mx-4 flex min-w-0 gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {views.map((view) => (
          <button
            key={view}
            onClick={() => setActiveView(view)}
            className={cn(
              "flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors sm:min-h-0",
              activeView === view
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
            )}
          >
            {view}
            <span className="rounded-full bg-background/50 px-1.5 py-0.5 text-[9px] text-muted-foreground">
              {counts[view as keyof typeof counts]}
            </span>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-dashed border-border/70 bg-card/20 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="text"
            placeholder="Adicionar tarefa rápida..."
            value={quickTitle}
            onChange={(event) => setQuickTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleQuickAdd();
            }}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {quickTitle && (
            <button
              type="button"
              onClick={() => void handleQuickAdd()}
              className="hidden h-9 shrink-0 rounded-md bg-secondary px-3 text-xs font-medium text-foreground hover:bg-accent sm:block"
            >
              Adicionar
            </button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/50 pt-2">
          <div className="flex items-center rounded-md bg-secondary/60 p-0.5">
            {priorities.map((priority) => (
              <button
                key={priority.value}
                type="button"
                onClick={() => setQuickPriority(priority.value)}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded px-2 text-[10px] transition-colors",
                  quickPriority === priority.value
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", priority.dot)} />
                {priority.label}
              </button>
            ))}
          </div>

          <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-secondary/60 hover:text-foreground">
            <input
              type="checkbox"
              checked={quickNoDeadline}
              onChange={(event) => setQuickNoDeadline(event.target.checked)}
              className="accent-primary"
            />
            Sem prazo
          </label>

          {quickTitle && (
            <button
              type="button"
              onClick={() => void handleQuickAdd()}
              className="ml-auto h-8 rounded-md bg-secondary px-3 text-[10px] font-medium text-foreground hover:bg-accent sm:hidden"
            >
              Adicionar
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-muted-foreground animate-pulse">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 rounded-full bg-secondary p-4">
            <CheckSquare className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="mb-1 text-lg font-semibold text-foreground">Nenhuma tarefa</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Não há tarefas nessa visualização.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((task) => {
            const items = (task.checklist as Subtask[]) || [];
            const progress = checklistProgress(task);
            const priority = priorities.find((item) => item.value === task.priority);

            return (
              <article
                key={task.id}
                className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-foreground/15 hover:bg-card-hover"
              >
                <div className="flex min-w-0 items-start gap-2 p-3 sm:items-center">
                  <button
                    type="button"
                    aria-label={task.status === "done" ? "Reabrir tarefa: " + task.title : "Concluir tarefa: " + task.title}
                    onClick={() => void toggleStatus(task)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
                  >
                    <span className={cn(
                      "flex h-5 w-5 items-center justify-center rounded border-2 transition-colors",
                      task.status === "done"
                        ? "border-primary bg-primary"
                        : "border-muted-foreground hover:border-foreground",
                    )}>
                      {task.status === "done" && <CheckSquare className="h-3 w-3 text-primary-foreground" />}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openEdit(task)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className={cn(
                      "line-clamp-2 break-words text-sm font-medium text-foreground sm:truncate",
                      task.status === "done" && "text-muted-foreground line-through",
                    )}>
                      {task.title}
                    </p>

                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      {priority && (
                        <span className={cn("inline-flex items-center gap-1 text-[10px]", priority.color)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", priority.dot)} />
                          {priority.label}
                        </span>
                      )}

                      <span className={cn(
                        "text-[10px]",
                        isOverdue(task) ? "text-destructive" : "text-muted-foreground",
                      )}>
                        {isOverdue(task)
                          ? "Atrasada"
                          : task.due_date === today
                            ? "Hoje"
                            : task.due_date === tomorrow
                              ? "Amanhã"
                              : task.due_date || "Sem prazo"}
                      </span>

                      {task.is_fixed_daily && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3" /> Diária
                        </span>
                      )}

                      {progress && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <ListChecks className="h-3 w-3" />
                          {progress.done}/{progress.total}
                        </span>
                      )}

                      {(task.tags || []).slice(0, 2).map((tag) => (
                        <span key={tag} className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => openEdit(task)}
                    aria-label={"Editar tarefa: " + task.title}
                    className="flex h-9 shrink-0 items-center justify-center rounded-md px-2 text-[10px] text-muted-foreground opacity-100 transition-opacity hover:bg-accent hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    Editar
                  </button>
                </div>

                {progress && (
                  <div className="px-3 pb-1 sm:pl-14 sm:pr-4">
                    <div className="h-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-foreground/50 transition-all"
                        style={{ width: String(progress.percent) + "%" }}
                      />
                    </div>
                  </div>
                )}

                {items.length > 0 && (
                  <div className="px-3 pb-3 sm:pl-14 sm:pr-4">
                    <Subtasks
                      items={items}
                      collapsible
                      onChange={async (next) => !!(await update(task.id, { checklist: next }, { silent: true }))}
                    />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <Dialog
        open={showDialog}
        onOpenChange={(open) => {
          if (open) {
            setShowDialog(true);
            return;
          }
          void closeEditor();
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event) => {
            if (editorFullscreen) {
              event.preventDefault();
              setEditorFullscreen(false);
            }
          }}
          className={cn(
            "border-border bg-card",
            editorFullscreen
              ? "!fixed !inset-0 !left-0 !top-0 !h-[100dvh] !w-screen !max-w-none !translate-x-0 !translate-y-0 !rounded-none"
              : "max-h-[92dvh] overflow-y-auto sm:max-w-2xl",
          )}
        >
          <DialogHeader className="pr-8">
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="text-foreground">
                  {editTask ? "Editar tarefa" : "Nova tarefa"}
                </DialogTitle>
                <p className={cn(
                  "mt-1 text-[10px]",
                  saveState === "error" ? "text-destructive" : "text-muted-foreground",
                  saveState === "saving" && "animate-pulse",
                )}>
                  {editTask ? saveLabel + " · Ctrl+S salva agora" : "Preencha o essencial e salve quando quiser"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setEditorFullscreen((active) => !active)}
                title={editorFullscreen ? "Sair da tela cheia" : "Tela cheia"}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {editorFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
            </div>
          </DialogHeader>

          <div className={cn("space-y-5", editorFullscreen && "mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-y-auto px-1")}>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Título</label>
              <input
                autoFocus
                type="text"
                value={form.title}
                onChange={(event) => setFormAndAutosave({ ...form, title: event.target.value })}
                placeholder="O que precisa ser feito?"
                className="h-11 w-full rounded-md border border-border bg-secondary px-3 text-base font-medium text-foreground outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Descrição</label>
              <textarea
                value={form.description}
                onChange={(event) => setFormAndAutosave({ ...form, description: event.target.value })}
                placeholder="Contexto, detalhes, links ou observações..."
                className="min-h-28 w-full resize-y rounded-md border border-border bg-secondary px-3 py-2.5 text-sm leading-relaxed text-foreground outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium text-muted-foreground">Prioridade</label>
              <div className="grid grid-cols-3 gap-2">
                {priorities.map((priority) => (
                  <button
                    key={priority.value}
                    type="button"
                    onClick={() => setFormAndAutosave({ ...form, priority: priority.value })}
                    className={cn(
                      "flex h-10 items-center justify-center gap-2 rounded-md border text-xs transition-colors",
                      form.priority === priority.value
                        ? "border-foreground/35 bg-accent text-foreground"
                        : "border-border bg-secondary/50 text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <span className={cn("h-2 w-2 rounded-full", priority.dot)} />
                    {priority.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="text-xs font-medium text-muted-foreground">Prazo</label>
                {form.due_date && (
                  <button
                    type="button"
                    onClick={() => setFormAndAutosave({ ...form, due_date: "" })}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    Remover prazo
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setFormAndAutosave({ ...form, due_date: today })}
                  className={cn(
                    "h-10 rounded-md border text-xs",
                    form.due_date === today
                      ? "border-foreground/35 bg-accent text-foreground"
                      : "border-border bg-secondary/50 text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  Hoje
                </button>
                <button
                  type="button"
                  onClick={() => setFormAndAutosave({ ...form, due_date: tomorrow })}
                  className={cn(
                    "h-10 rounded-md border text-xs",
                    form.due_date === tomorrow
                      ? "border-foreground/35 bg-accent text-foreground"
                      : "border-border bg-secondary/50 text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  Amanhã
                </button>
                <button
                  type="button"
                  onClick={() => setFormAndAutosave({ ...form, due_date: "" })}
                  className={cn(
                    "h-10 rounded-md border text-xs",
                    !form.due_date
                      ? "border-foreground/35 bg-accent text-foreground"
                      : "border-border bg-secondary/50 text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  Sem prazo
                </button>
              </div>

              <div className="relative mt-2">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="date"
                  aria-label="Data personalizada"
                  value={form.due_date}
                  onChange={(event) => setFormAndAutosave({ ...form, due_date: event.target.value })}
                  className="h-10 w-full rounded-md border border-border bg-secondary pl-10 pr-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-secondary/35 p-3">
              <input
                type="checkbox"
                checked={form.is_fixed_daily}
                onChange={(event) => setFormAndAutosave({ ...form, is_fixed_daily: event.target.checked })}
                className="mt-0.5 accent-primary"
              />
              <div>
                <p className="text-sm font-medium text-foreground">Tarefa fixa diária</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">Use para rotinas que precisam aparecer todos os dias.</p>
              </div>
            </label>

            <div className="rounded-lg border border-border bg-background/30 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-foreground">Subtarefas</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">Quebre a tarefa em passos menores.</p>
                </div>
                {checklist.length > 0 && (
                  <span className="text-xs font-medium text-foreground">{editorProgress}%</span>
                )}
              </div>

              <Subtasks
                key={editTask?.id || "new"}
                items={checklist}
                disabled={saving}
                onChange={handleChecklistChange}
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium text-muted-foreground">Tags</label>
              <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1.5">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => removeTag(tag)}
                    title="Clique para remover"
                    className="inline-flex h-7 items-center gap-1 rounded-full bg-accent px-2 text-[10px] text-foreground"
                  >
                    <Tag className="h-3 w-3" /> #{tag} <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                ))}

                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                  onBlur={addTag}
                  placeholder={tags.length ? "Adicionar..." : "Ex.: trabalho, urgente"}
                  className="h-7 min-w-28 flex-1 bg-transparent px-1 text-xs text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>

            {editTask && (
              <div className="grid grid-cols-1 gap-2 border-t border-border pt-4 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => void toggleEditorStatus()}
                  className="flex h-10 items-center justify-center gap-2 rounded-md bg-secondary text-sm text-foreground hover:bg-accent"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {editTask.status === "done" ? "Reabrir" : "Concluir"}
                </button>

                <button
                  type="button"
                  onClick={() => void duplicateTask()}
                  className="flex h-10 items-center justify-center gap-2 rounded-md bg-secondary text-sm text-foreground hover:bg-accent"
                >
                  <Copy className="h-4 w-4" /> Duplicar
                </button>

                <button
                  type="button"
                  onClick={() => setDeleteConfirm(editTask.id)}
                  className="flex h-10 items-center justify-center gap-2 rounded-md text-sm text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" /> Excluir
                </button>
              </div>
            )}

            <div className="sticky bottom-0 -mx-1 flex gap-2 border-t border-border bg-card/95 px-1 pt-3 pb-1 backdrop-blur">
              <button
                type="button"
                onClick={() => void closeEditor()}
                disabled={saving}
                className="h-11 rounded-md bg-secondary px-4 text-sm text-foreground hover:bg-accent disabled:opacity-50"
              >
                Fechar
              </button>

              <button
                type="button"
                disabled={saving || !form.title.trim()}
                onClick={() => void persistEditor(true)}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? "Salvando..." : editTask ? "Salvar agora" : "Criar tarefa"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
      >
        <DialogContent className="border-border bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">Excluir tarefa</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja excluir esta tarefa? Essa ação não pode ser desfeita.
          </p>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              onClick={() => setDeleteConfirm(null)}
              className="min-h-11 rounded-md bg-secondary px-4 py-2 text-sm text-foreground hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              onClick={() => deleteConfirm && void handleDelete(deleteConfirm)}
              className="min-h-11 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir tarefa
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Tarefas;
