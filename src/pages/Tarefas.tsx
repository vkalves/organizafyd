import { CheckSquare, Plus, Trash2, Edit2, X, Save, Clock, AlertTriangle, ListChecks, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatDate, parseLocalDate, toLocalDateInput } from "@/lib/date";

const views = ["Hoje", "Semana", "Prioridade", "Concluídas", "Todas"];
const priorities = [
  { value: "low", label: "Baixa", color: "text-muted-foreground" },
  { value: "medium", label: "Média", color: "text-warning" },
  { value: "high", label: "Alta", color: "text-destructive" },
];

interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: string | null;
  status: string | null;
  due_date: string | null;
  is_fixed_daily: boolean | null;
  tags: string[] | null;
  checklist: ChecklistItem[] | null;
  completed_at: string | null;
  created_at: string;
}

const Tarefas = () => {
  const [activeView, setActiveView] = useState("Todas");
  const { data: tasks, loading, mutating, create, update, remove } = useSupabaseCrud<Task>("tasks");
  const [showDialog, setShowDialog] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [form, setForm] = useState({ title: "", description: "", priority: "medium", due_date: "", is_fixed_daily: false });
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newCheckItem, setNewCheckItem] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const today = toLocalDateInput();

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    const now = parseLocalDate(today);
    const weekEnd = new Date(now);
    weekEnd.setDate(now.getDate() + 7);
    const priorityWeight: Record<string, number> = { high: 0, medium: 1, low: 2 };

    return tasks.filter((task) => {
      if (term && !`${task.title} ${task.description || ""}`.toLocaleLowerCase("pt-BR").includes(term)) return false;
      if (activeView === "Hoje") return task.due_date === today && task.status !== "done";
      if (activeView === "Prioridade") return task.priority === "high" && task.status !== "done";
      if (activeView === "Concluídas") return task.status === "done";
      if (activeView === "Semana") {
        if (!task.due_date || task.status === "done") return false;
        const dueDate = parseLocalDate(task.due_date);
        return dueDate >= now && dueDate <= weekEnd;
      }
      return true;
    }).sort((a, b) => {
      if (a.status === "done" && b.status !== "done") return 1;
      if (a.status !== "done" && b.status === "done") return -1;
      if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date && !b.due_date) return -1;
      if (!a.due_date && b.due_date) return 1;
      return (priorityWeight[a.priority || "low"] ?? 3) - (priorityWeight[b.priority || "low"] ?? 3);
    });
  }, [activeView, search, tasks, today]);

  const pendingCount = tasks.filter((task) => task.status !== "done").length;
  const overdueCount = tasks.filter((task) => task.due_date && task.due_date < today && task.status !== "done").length;

  const handleQuickAdd = async () => {
    if (!quickTitle.trim()) return;
    const created = await create({ title: quickTitle.trim(), due_date: today, priority: "medium", status: "todo" });
    if (created) setQuickTitle("");
  };

  const openCreate = () => {
    setEditTask(null);
    setForm({ title: "", description: "", priority: "medium", due_date: today, is_fixed_daily: false });
    setChecklist([]);
    setShowDialog(true);
  };

  const openEdit = (t: Task) => {
    setEditTask(t);
    setForm({ title: t.title, description: t.description || "", priority: t.priority || "medium", due_date: t.due_date || "", is_fixed_daily: t.is_fixed_daily || false });
    setChecklist((t.checklist as ChecklistItem[]) || []);
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return toast.error("Título obrigatório");
    const payload = { ...form, checklist: checklist.length > 0 ? checklist : null };
    const saved = editTask
      ? await update(editTask.id, payload)
      : await create({ ...payload, status: "todo" });
    if (saved) setShowDialog(false);
  };

  const toggleStatus = async (t: Task) => {
    const newStatus = t.status === "done" ? "todo" : "done";
    await update(t.id, { status: newStatus, completed_at: newStatus === "done" ? new Date().toISOString() : null });
  };

  const handleDelete = async (id: string) => {
    const removed = await remove(id);
    if (removed) setDeleteConfirm(null);
  };

  const addCheckItem = () => {
    if (!newCheckItem.trim()) return;
    setChecklist([...checklist, { id: crypto.randomUUID(), text: newCheckItem.trim(), done: false }]);
    setNewCheckItem("");
  };

  const toggleCheckItem = (id: string) => {
    setChecklist(checklist.map(c => c.id === id ? { ...c, done: !c.done } : c));
  };

  const removeCheckItem = (id: string) => {
    setChecklist(checklist.filter(c => c.id !== id));
  };

  // Quick toggle checklist item directly in task list
  const toggleChecklistInline = async (task: Task, itemId: string) => {
    const items = (task.checklist as ChecklistItem[]) || [];
    const updated = items.map(c => c.id === itemId ? { ...c, done: !c.done } : c);
    await update(task.id, { checklist: updated });
  };

  const isOverdue = (t: Task) => t.due_date && t.due_date < today && t.status !== "done";
  const checklistProgress = (t: Task) => {
    const items = (t.checklist as ChecklistItem[]) || [];
    if (items.length === 0) return null;
    const done = items.filter(c => c.done).length;
    return `${done}/${items.length}`;
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">Planejamento</p>
          <h1 className="page-title">Tarefas</h1>
          <p className="page-description">{pendingCount} pendente{pendingCount === 1 ? "" : "s"}{overdueCount > 0 ? ` · ${overdueCount} atrasada${overdueCount === 1 ? "" : "s"}` : ""}</p>
        </div>
        <button onClick={openCreate} className="action-primary">
          <Plus className="h-4 w-4" /> Nova tarefa
        </button>
      </div>

      <div className="toolbar-panel">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input aria-label="Buscar tarefas" className="field h-10 pl-9" placeholder="Buscar tarefas…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Filtrar tarefas">
          {views.map((view) => (
            <button key={view} role="tab" aria-selected={activeView === view} onClick={() => setActiveView(view)} className={cn("filter-chip", activeView === view && "filter-chip-active")}>{view}</button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 p-3 focus-within:border-foreground/25">
        <Plus className="w-4 h-4 text-muted-foreground" />
        <input aria-label="Adicionar tarefa rápida" type="text" placeholder="Adicionar tarefa para hoje…" value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleQuickAdd()}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none" />
        {quickTitle && <button disabled={mutating} onClick={() => void handleQuickAdd()} className="text-xs font-semibold text-foreground hover:underline disabled:opacity-50">Adicionar</button>}
      </div>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground animate-pulse">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 rounded-full bg-secondary mb-4"><CheckSquare className="w-8 h-8 text-muted-foreground" /></div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Nenhuma tarefa</h2>
          <p className="text-sm text-muted-foreground max-w-sm">{search ? "Tente outro termo ou filtro." : "Comece adicionando suas tarefas para organizar seu dia."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const clItems = (t.checklist as ChecklistItem[]) || [];
            const clProgress = checklistProgress(t);
            return (
              <div key={t.id} className="rounded-lg bg-card border border-border hover:bg-card-hover transition-colors group">
                <div className="flex items-center gap-3 p-3">
                  <button aria-label={t.status === "done" ? `Reabrir ${t.title}` : `Concluir ${t.title}`} aria-pressed={t.status === "done"} onClick={() => void toggleStatus(t)} className={cn(
                    "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                    t.status === "done" ? "bg-primary border-primary" : "border-muted-foreground hover:border-foreground"
                  )}>
                    {t.status === "done" && <CheckSquare className="w-3 h-3 text-primary-foreground" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm text-foreground truncate", t.status === "done" && "line-through text-muted-foreground")}>{t.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {t.priority && <span className={cn("text-[10px]", priorities.find(p => p.value === t.priority)?.color)}>{priorities.find(p => p.value === t.priority)?.label}</span>}
                      {t.due_date && <span className="text-[10px] text-muted-foreground">{formatDate(t.due_date)}</span>}
                      {isOverdue(t) && <AlertTriangle className="w-3 h-3 text-destructive" />}
                      {t.is_fixed_daily && <span title="Tarefa fixa diária"><Clock className="w-3 h-3 text-info" /></span>}
                      {clProgress && <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><ListChecks className="w-3 h-3" />{clProgress}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                    <button aria-label={`Editar ${t.title}`} onClick={() => openEdit(t)} className="icon-button-sm"><Edit2 className="w-3.5 h-3.5" /></button>
                    <button aria-label={`Excluir ${t.title}`} onClick={() => setDeleteConfirm(t.id)} className="icon-button-sm text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                {/* Inline checklist */}
                {clItems.length > 0 && t.status !== "done" && (
                  <div className="px-3 pb-3 pl-11 space-y-1">
                    {clItems.map(ci => (
                      <label key={ci.id} className="flex items-center gap-2 cursor-pointer group/check">
                        <input type="checkbox" checked={ci.done} onChange={() => toggleChecklistInline(t, ci.id)}
                          className="rounded accent-primary" />
                        <span className={cn("text-xs text-foreground", ci.done && "line-through text-muted-foreground")}>{ci.text}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-foreground">{editTask ? "Editar Tarefa" : "Nova Tarefa"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Título</label>
              <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Descrição</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full h-20 px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Prioridade</label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
                  {priorities.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Data</label>
                <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                  className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none" />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_fixed_daily} onChange={(e) => setForm({ ...form, is_fixed_daily: e.target.checked })} className="rounded" />
              <span className="text-sm text-foreground">Tarefa fixa diária (reseta todo dia)</span>
            </label>

            {/* Checklist */}
            <div>
              <label className="block text-xs text-muted-foreground mb-2">Checklist</label>
              <div className="space-y-1.5 mb-2">
                {checklist.map(ci => (
                  <div key={ci.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={ci.done} onChange={() => toggleCheckItem(ci.id)} className="rounded accent-primary" />
                    <span className={cn("text-sm text-foreground flex-1", ci.done && "line-through text-muted-foreground")}>{ci.text}</span>
                    <button onClick={() => removeCheckItem(ci.id)} className="p-1 rounded hover:bg-accent"><X className="w-3 h-3 text-destructive" /></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input type="text" placeholder="Novo item..." value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addCheckItem()}
                  className="flex-1 h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none" />
                <button onClick={addCheckItem} className="px-3 h-9 rounded-md bg-secondary text-sm text-foreground hover:bg-accent"><Plus className="w-4 h-4" /></button>
              </div>
            </div>

            <button onClick={() => void handleSave()} disabled={mutating} className="action-primary w-full justify-center">
              <Save className="w-4 h-4 inline mr-2" />{editTask ? "Salvar" : "Criar"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Confirmar exclusão</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Tem certeza que deseja excluir esta tarefa?</p>
          <div className="flex gap-2 justify-end mt-4">
            <button onClick={() => setDeleteConfirm(null)} className="action-secondary">Cancelar</button>
            <button disabled={mutating} onClick={() => { if (deleteConfirm) void handleDelete(deleteConfirm); }} className="action-danger">Excluir</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Tarefas;
