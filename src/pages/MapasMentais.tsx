import { useMemo, useState } from "react";
import { Clock3, Network, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { BrandIcon } from "@/features/mindmap/BrandIcons";
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
  const [search, setSearch] = useState("");

  const filteredMaps = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    if (!query) return maps;
    return maps.filter((map) => {
      const text = `${map.title} ${map.description ?? ""}`.toLocaleLowerCase("pt-BR");
      return text.includes(query);
    });
  }, [maps, search]);

  const totalBlocks = useMemo(
    () => maps.reduce((total, map) => total + (map.data?.root ? countTopics(map.data.root) : 1), 0),
    [maps],
  );

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
      <div className="rounded-xl border border-border bg-card/40 p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-secondary">
                <Network className="h-4 w-4 text-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Mapas mentais</h1>
                <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                  Organize ideias, links e canais em blocos conectados.
                </p>
              </div>
            </div>

            {!loading && maps.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-border bg-secondary/55 px-2.5 py-1 text-[10px] text-muted-foreground">
                  {maps.length} {maps.length === 1 ? "mapa" : "mapas"}
                </span>
                <span className="rounded-full border border-border bg-secondary/55 px-2.5 py-1 text-[10px] text-muted-foreground">
                  {totalBlocks} {totalBlocks === 1 ? "bloco" : "blocos"}
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={openCreate}
            className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:min-h-10"
          >
            <Plus className="h-4 w-4" /> Novo mapa
          </button>
        </div>
      </div>

      {!loading && maps.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar mapa mental..."
            className="h-11 w-full rounded-lg border border-border bg-card pl-10 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-foreground/25 sm:max-w-md"
          />
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-muted-foreground animate-pulse">Carregando...</div>
      ) : maps.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/20 py-20 text-center">
          <div className="mb-4 rounded-xl border border-border bg-secondary p-4">
            <Network className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="mb-1 text-lg font-semibold text-foreground">Nenhum mapa mental</h2>
          <p className="max-w-sm px-4 text-sm text-muted-foreground">
            Crie um tema central e conecte ideias, perfis, links, tarefas ou qualquer informação importante.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-5 flex h-10 items-center gap-2 rounded-md bg-secondary px-4 text-sm text-foreground hover:bg-accent"
          >
            <Plus className="h-4 w-4" /> Criar primeiro mapa
          </button>
        </div>
      ) : filteredMaps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <Search className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Nenhum mapa encontrado</p>
          <p className="mt-1 text-xs text-muted-foreground">Tente outro termo na busca.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredMaps.map((map) => {
            const blocks = map.data?.root ? countTopics(map.data.root) : 1;
            const rootIcon = map.data?.root?.icon;
            return (
              <div
                key={map.id}
                className="group relative overflow-hidden rounded-xl border border-border bg-card transition-all duration-150 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-lg"
              >
                <button
                  type="button"
                  onClick={() => {
                    setOpenMap(map);
                    setDraft(map.data);
                  }}
                  className="w-full p-4 text-left"
                >
                  <div className="mb-4 flex items-start justify-between gap-3 pr-8">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-secondary text-foreground">
                      {rootIcon && rootIcon !== "none" ? (
                        <BrandIcon name={rootIcon} className="h-5 w-5" />
                      ) : (
                        <Network className="h-4 w-4" />
                      )}
                    </div>
                    <span className="rounded-full border border-border bg-secondary/55 px-2 py-1 text-[9px] text-muted-foreground">
                      {blocks} {blocks === 1 ? "bloco" : "blocos"}
                    </span>
                  </div>

                  <h3 className="truncate text-sm font-semibold text-foreground">{map.title}</h3>
                  {map.description ? (
                    <p className="mt-1.5 line-clamp-2 min-h-8 text-xs leading-relaxed text-muted-foreground">{map.description}</p>
                  ) : (
                    <p className="mt-1.5 min-h-8 text-xs text-muted-foreground/55">Sem descrição</p>
                  )}

                  <div className="mt-4 flex items-center gap-1.5 border-t border-border/70 pt-3 text-[10px] text-muted-foreground">
                    <Clock3 className="h-3 w-3" />
                    Atualizado em {new Date(map.updated_at).toLocaleDateString("pt-BR")}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setDeleteId(map.id)}
                  className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-100 transition-colors hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
                  aria-label={`Excluir mapa: ${map.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="border-border bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">Novo mapa mental</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Tema central</label>
              <input
                autoFocus
                type="text"
                placeholder="Ex.: Estratégia Instagram"
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                onKeyDown={(event) => event.key === "Enter" && void handleCreate()}
                className="h-10 w-full rounded-md border border-border bg-secondary px-3 text-sm text-foreground outline-none focus:border-foreground/30 focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Descrição</label>
              <textarea
                placeholder="Objetivo ou contexto do mapa (opcional)"
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                className="h-20 w-full resize-none rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/30"
              />
            </div>
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

      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent className="border-border bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">Excluir mapa</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Essa ação apaga o mapa inteiro e não pode ser desfeita.</p>
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
