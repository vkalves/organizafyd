import { useState } from "react";
import { Network, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { MindMapCanvas } from "@/features/mindmap/MindMapCanvas";
import { countTopics, createMindMapData, type MindMapData } from "@/features/mindmap/types";

interface MindMapRow {
  id: string;
  title: string;
  description: string | null;
  data: MindMapData;
  created_at: string;
  updated_at: string;
}

const MapasMentais = () => {
  const { data: maps, loading, create, update, remove } = useSupabaseCrud<MindMapRow>("mind_maps", "updated_at");
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState({ title: "", description: "" });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [openMap, setOpenMap] = useState<MindMapRow | null>(null);
  const [draft, setDraft] = useState<MindMapData | null>(null);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setForm({ title: "", description: "" });
    setShowDialog(true);
  };

  const handleCreate = async () => {
    if (!form.title.trim()) return toast.error("Título obrigatório");
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      data: createMindMapData(form.title.trim(), form.description.trim()),
    };
    const created = await create(payload);
    if (!created) return;
    setShowDialog(false);
    setOpenMap(created);
    setDraft(created.data);
  };

  const handleSaveTree = async (next: MindMapData) => {
    if (!openMap) return;
    setSaving(true);
    const updated = await update(openMap.id, {
      data: next,
      title: next.root.title || openMap.title,
      description: next.root.description || openMap.description,
    });
    setSaving(false);
    if (updated) {
      setOpenMap(updated);
      setDraft(updated.data);
    }
  };

  if (openMap && draft) {
    return (
      <MindMapCanvas
        title={openMap.title}
        data={draft}
        saving={saving}
        onBack={() => {
          setOpenMap(null);
          setDraft(null);
        }}
        onChange={setDraft}
        onSave={handleSaveTree}
      />
    );
  }

  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Mapas mentais</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie mapas interativos com centro, ramos e expansão por clique.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:min-h-0"
        >
          <Plus className="h-4 w-4" /> Novo mapa
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-muted-foreground animate-pulse">Carregando...</div>
      ) : maps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 rounded-full bg-secondary p-4">
            <Network className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="mb-1 text-lg font-semibold text-foreground">Nenhum mapa mental</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Comece com um tema central e vá abrindo blocos para os lados, como no mapa de referência.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {maps.map((map) => (
            <button
              key={map.id}
              type="button"
              onClick={() => {
                setOpenMap(map);
                setDraft(map.data);
              }}
              className="group rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-card-hover"
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="rounded-md bg-secondary p-2">
                  <Network className="h-4 w-4 text-foreground" />
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    setDeleteId(map.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      setDeleteId(map.id);
                    }
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-destructive opacity-100 hover:bg-accent sm:opacity-0 sm:group-hover:opacity-100"
                  aria-label={`Excluir mapa: ${map.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </span>
              </div>
              <h3 className="text-sm font-medium text-foreground">{map.title}</h3>
              {map.description && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{map.description}</p>
              )}
              <p className="mt-3 text-[10px] text-muted-foreground">
                {map.data?.root ? countTopics(map.data.root) : 1} blocos · {new Date(map.updated_at).toLocaleDateString("pt-BR")}
              </p>
            </button>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="border-border bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">Novo mapa mental</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Tema central"
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              onKeyDown={(event) => event.key === "Enter" && void handleCreate()}
              className="h-10 w-full rounded-md border border-border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <textarea
              placeholder="Descrição do centro (opcional)"
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              className="h-20 w-full resize-none rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Criar mapa
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="border-border bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">Excluir mapa</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Essa ação não pode ser desfeita.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteId(null)} className="rounded-md bg-secondary px-4 py-2 text-sm text-foreground">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => deleteId && remove(deleteId).then(() => setDeleteId(null))}
              className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground"
            >
              Excluir
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MapasMentais;
