import { CheckSquare, Plus, Trash2, Edit2, X, Save, Clock, AlertTriangle, ListChecks } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

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
  const { data: tasks, loading, create, update, remove } = useSupabaseCrud<Task>("tasks");
  const [showDialog, setShowDialog] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [form, setForm] = useState({ title: "", description: "", priority: "medium", due_date: "", is_fixed_daily: false });
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newCheckItem, setNewCheckItem] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const today = new Date().toISOString().split("T")[0];

  const filtered = tasks.filter((t) => {
    if (activeView === "Hoje") return t.due_date === today && t.status !== "done";
    if (activeView === "Prioridade") return t.priority === "high" && t.status !== "done";
    if (activeView === "Concluídas") return t.status === "done";
    if (activeView === "Semana") {
      if (!t.due_date) return false;
      const d = new Date(t.due_date);
      const now = new Date();
      const weekEnd = new Date(now);
      weekEnd.setDate(now.getDate() + 7);
      return d >= now && d <= weekEnd && t.status !== "done";
    }
    return true;
  });

  const handleQuickAdd = async () => {
    if (!quickTitle.trim()) return;
    await create({ title: quickTitle.trim(), due_date: today, priority: "medium", status: "todo" });
    setQuickTitle("");
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
    if (editTask) {
      await update(editTask.id, payload);
    } else {
      await create({ ...payload, status: "todo" });
    }
    setShowDialog(false);
  };

  const toggleStatus = async (t: Task) => {
    const newStatus = t.status === "done" ? "todo" : "done";
    await update(t.id, { status: newStatus, completed_at: newStatus === "done" ? new Date().toISOString() : null });
  };

  const handleDelete = async (id: string) => {
    await remove(id);
    setDeleteConfirm(null);
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
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Tarefas</h1>
          <p className="text-sm text-muted-foreground mt-1">Organize seu dia e suas metas</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" /> Nova Tarefa
        </button>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {views.map((view) => (
          <button key={view} onClick={() => setActiveView(view)} className={cn(
            "px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors",
            activeView === view ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          )}>{view}</button>
        ))}
      </div>

      <div className="flex items-center gap-2 p-3 rounded-md border border-border/50 border-dashed">
        <Plus className="w-4 h-4 text-muted-foreground" />
        <input type="text" placeholder="Adicionar tarefa rápida..." value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleQuickAdd()}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none" />
        {quickTitle && <button onClick={handleQuickAdd} className="text-xs text-primary hover:underline">Adicionar</button>}
      </div>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground animate-pulse">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 rounded-full bg-secondary mb-4"><CheckSquare className="w-8 h-8 text-muted-foreground" /></div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Nenhuma tarefa</h2>
          <p className="text-sm text-muted-foreground max-w-sm">Comece adicionando suas tarefas para organizar seu dia.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const clItems = (t.checklist as ChecklistItem[]) || [];
            const clProgress = checklistProgress(t);
            return (
              <div key={t.id} className="rounded-lg bg-card border border-border hover:bg-card-hover transition-colors group">
                <div className="flex items-center gap-3 p-3">
                  <button onClick={() => toggleStatus(t)} className={cn(
                    "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                    t.status === "done" ? "bg-primary border-primary" : "border-muted-foreground hover:border-foreground"
                  )}>
                    {t.status === "done" && <CheckSquare className="w-3 h-3 text-primary-foreground" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm text-foreground truncate", t.status === "done" && "line-through text-muted-foreground")}>{t.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {t.priority && <span className={cn("text-[10px]", priorities.find(p => p.value === t.priority)?.color)}>{priorities.find(p => p.value === t.priority)?.label}</span>}
                      {t.due_date && <span className="text-[10px] text-muted-foreground">{t.due_date}</span>}
                      {isOverdue(t) && <AlertTriangle className="w-3 h-3 text-destructive" />}
                      {t.is_fixed_daily && <span title="Tarefa fixa diária"><Clock className="w-3 h-3 text-info" /></span>}
                      {clProgress && <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><ListChecks className="w-3 h-3" />{clProgress}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-accent"><Edit2 className="w-3.5 h-3.5 text-muted-foreground" /></button>
                    <button onClick={() => setDeleteConfirm(t.id)} className="p-1.5 rounded hover:bg-accent"><Trash2 className="w-3.5 h-3.5 text-destructive" /></button>
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

            <button onClick={handleSave} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
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
            <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 rounded-md bg-secondary text-sm text-foreground hover:bg-accent transition-colors">Cancelar</button>
            <button onClick={() => deleteConfirm && handleDelete(deleteConfirm)} className="px-4 py-2 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors">Excluir</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Tarefas;
