import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, Edit2, Plus, Save, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface Subtask {
  id: string;
  text: string;
  done: boolean;
}

interface SubtasksProps {
  items: Subtask[];
  onChange: (items: Subtask[]) => Promise<boolean> | boolean;
  collapsible?: boolean;
  disabled?: boolean;
}

export function Subtasks({ items, onChange, collapsible = false, disabled = false }: SubtasksProps) {
  const [expanded, setExpanded] = useState(true);
  const [title, setTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const locked = disabled || saving;
  const done = items.filter(item => item.done).length;

  const commit = async (next: Subtask[], onSuccess?: () => void) => {
    if (busy.current || disabled) return;
    busy.current = true;
    setSaving(true);
    try {
      if (await onChange(next)) onSuccess?.();
    } catch {
      toast.error("Não foi possível salvar a subtarefa. Tente novamente.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const add = () => {
    if (!title.trim()) return;
    void commit([...items, { id: crypto.randomUUID(), text: title.trim(), done: false }], () => setTitle(""));
  };

  const saveEdit = () => {
    if (!editTitle.trim()) return;
    void commit(items.map(item => item.id === editingId ? { ...item, text: editTitle.trim() } : item), () => setEditingId(null));
  };

  return (
    <section className="space-y-2" aria-label="Subtarefas" aria-busy={saving}>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        {collapsible ? (
          <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="flex items-center gap-1 py-1">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Subtarefas
          </button>
        ) : <span>Subtarefas</span>}
        <span aria-live="polite">{done}/{items.length} concluídas</span>
      </div>
      {expanded && (
        <>
          {items.length > 0 && <div role="progressbar" aria-label="Progresso das subtarefas" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} className="h-1 overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-primary transition-all" style={{ width: `${done / items.length * 100}%` }} />
          </div>}
          <ul className="space-y-1">
            {items.map(item => (
              <li key={item.id} className="flex items-center gap-2">
                <input type="checkbox" aria-label={`Concluir subtarefa: ${item.text}`} checked={item.done} disabled={locked}
                  onChange={() => void commit(items.map(current => current.id === item.id ? { ...current, done: !current.done } : current))}
                  className="shrink-0 accent-primary" />
                {editingId === item.id ? (
                  <>
                    <input autoFocus aria-label="Editar subtarefa" value={editTitle} disabled={locked} onChange={e => setEditTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveEdit(); } if (e.key === "Escape") { e.stopPropagation(); setEditingId(null); } }}
                      className="min-w-0 flex-1 rounded-md border border-border bg-secondary px-2 py-1 text-sm" />
                    <button type="button" aria-label="Salvar subtarefa" disabled={locked || !editTitle.trim()} onClick={saveEdit} className="p-2 hover:bg-accent rounded disabled:opacity-50"><Save className="h-4 w-4" /></button>
                    <button type="button" aria-label="Cancelar edição" disabled={locked} onClick={() => setEditingId(null)} className="p-2 hover:bg-accent rounded"><X className="h-4 w-4" /></button>
                  </>
                ) : (
                  <>
                    <span className={cn("min-w-0 flex-1 break-words text-sm text-foreground", item.done && "line-through text-muted-foreground")}>{item.text}</span>
                    <button type="button" aria-label={`Editar subtarefa: ${item.text}`} disabled={locked} onClick={() => { setEditingId(item.id); setEditTitle(item.text); }} className="p-2 hover:bg-accent rounded text-muted-foreground"><Edit2 className="h-4 w-4" /></button>
                    <button type="button" aria-label={`Excluir subtarefa: ${item.text}`} disabled={locked} onClick={() => void commit(items.filter(current => current.id !== item.id))} className="p-2 hover:bg-accent rounded text-destructive"><Trash2 className="h-4 w-4" /></button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input aria-label="Nova subtarefa" placeholder="Adicionar subtarefa..." value={title} disabled={locked} onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
              className="min-w-0 flex-1 h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <button type="button" aria-label="Adicionar subtarefa" disabled={locked || !title.trim()} onClick={add} className="px-3 h-9 rounded-md bg-secondary hover:bg-accent disabled:opacity-50"><Plus className="w-4 h-4" /></button>
          </div>
        </>
      )}
    </section>
  );
}
