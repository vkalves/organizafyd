import { useMemo, useRef, useState } from "react";
import {
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Edit2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
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

export function Subtasks({
  items,
  onChange,
  collapsible = false,
  disabled = false,
}: SubtasksProps) {
  const [expanded, setExpanded] = useState(true);
  const [title, setTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  const locked = disabled || saving;
  const done = useMemo(() => items.filter((item) => item.done).length, [items]);
  const progress = items.length ? Math.round((done / items.length) * 100) : 0;

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

    void commit(
      [
        ...items,
        {
          id: crypto.randomUUID(),
          text: title.trim(),
          done: false,
        },
      ],
      () => setTitle(""),
    );
  };

  const saveEdit = () => {
    if (!editTitle.trim()) return;

    void commit(
      items.map((item) =>
        item.id === editingId ? { ...item, text: editTitle.trim() } : item,
      ),
      () => setEditingId(null),
    );
  };

  const markAll = () => {
    void commit(items.map((item) => ({ ...item, done: true })));
  };

  const clearCompleted = () => {
    void commit(items.filter((item) => !item.done));
  };

  return (
    <section
      className="min-w-0 space-y-2"
      aria-label="Subtarefas"
      aria-busy={saving}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            className="flex min-w-0 items-center gap-1 rounded py-1 transition-colors hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
            <span>Subtarefas</span>
          </button>
        ) : (
          <span>Subtarefas</span>
        )}

        <span className="shrink-0" aria-live="polite">
          {items.length ? done + "/" + items.length + " · " + progress + "%" : "Nenhuma"}
        </span>
      </div>

      {expanded && (
        <>
          {items.length > 0 && (
            <div
              role="progressbar"
              aria-label="Progresso das subtarefas"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="h-1 overflow-hidden rounded-full bg-secondary"
            >
              <div
                className="h-full rounded-full bg-foreground/60 transition-all duration-200"
                style={{ width: String(progress) + "%" }}
              />
            </div>
          )}

          <ul className="space-y-1">
            {items.map((item) => (
              <li
                key={item.id}
                className="group/subtask flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-accent/30 sm:gap-2"
              >
                <input
                  type="checkbox"
                  aria-label={"Concluir subtarefa: " + item.text}
                  checked={item.done}
                  disabled={locked}
                  onChange={() =>
                    void commit(
                      items.map((current) =>
                        current.id === item.id
                          ? { ...current, done: !current.done }
                          : current,
                      ),
                    )
                  }
                  className="h-4 w-4 shrink-0 accent-primary"
                />

                {editingId === item.id ? (
                  <>
                    <input
                      autoFocus
                      aria-label="Editar subtarefa"
                      value={editTitle}
                      disabled={locked}
                      onChange={(event) => setEditTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          saveEdit();
                        }
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          setEditingId(null);
                        }
                      }}
                      className="h-9 min-w-0 flex-1 rounded-md border border-border bg-secondary px-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button
                      type="button"
                      aria-label="Salvar subtarefa"
                      disabled={locked || !editTitle.trim()}
                      onClick={saveEdit}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Cancelar edição"
                      disabled={locked}
                      onClick={() => setEditingId(null)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={locked}
                      onDoubleClick={() => {
                        setEditingId(item.id);
                        setEditTitle(item.text);
                      }}
                      className={cn(
                        "min-w-0 flex-1 break-words py-1 text-left text-sm text-foreground",
                        item.done && "text-muted-foreground line-through",
                      )}
                      title="Clique duplo para editar"
                    >
                      {item.text}
                    </button>

                    <div className="flex shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/subtask:opacity-100 sm:group-focus-within/subtask:opacity-100">
                      <button
                        type="button"
                        aria-label={"Editar subtarefa: " + item.text}
                        disabled={locked}
                        onClick={() => {
                          setEditingId(item.id);
                          setEditTitle(item.text);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={"Excluir subtarefa: " + item.text}
                        disabled={locked}
                        onClick={() =>
                          void commit(items.filter((current) => current.id !== item.id))
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>

          <div className="flex min-w-0 gap-2">
            <input
              aria-label="Nova subtarefa"
              placeholder="Adicionar subtarefa..."
              value={title}
              disabled={locked}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-secondary px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              aria-label="Adicionar subtarefa"
              disabled={locked || !title.trim()}
              onClick={add}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary hover:bg-accent disabled:opacity-50 sm:w-auto sm:px-3"
            >
              <Plus className="h-4 w-4" />
              <span className="ml-1 hidden sm:inline">Adicionar</span>
            </button>
          </div>

          {!collapsible && items.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {done < items.length && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={markAll}
                  className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> Concluir todas
                </button>
              )}

              {done > 0 && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={clearCompleted}
                  className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Limpar concluídas
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
