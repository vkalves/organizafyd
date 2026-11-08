import { useMemo, useState } from "react";
import { Clock3, Network, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { BrandIcon } from "@/features/mindmap/BrandIcons";
import {
  getMindMapLayoutLabel,
  LayoutPreview,
  MIND_MAP_LAYOUTS,
  MindMapCanvas,
} from "@/features/mindmap/MindMapCanvas";
import {
  countTopics,
  createMindMapData,
  type MindMapData,
  type MindMapLayout,
} from "@/features/mindmap/types";

import { isSlideData } from "@/features/slides/types";

interface MindMapRow {
  id: string;
  title: string;
  description: string | null;
  data: MindMapData;
  created_at: string;
  updated_at: string;
}

const MapasMentais = () => {
  const { data: allMaps, loading, create, update, remove } = useSupabaseCrud<MindMapRow>("mind_maps", "updated_at");
  const maps = useMemo(() => allMaps.filter(map => !isSlideData(map.data)), [allMaps]);
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState<{ title: string; description: string; layout: MindMapLayout }>({
    title: "",
    description: "",
    layout: "radial",
  });
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
    setForm({ title: "", description: "", layout: "radial" });
    setShowDialog(true);
  };

  const handleCreate = async () => {
    if (!form.title.trim()) return toast.error("Título obrigatório");
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      data: createMindMapData(form.title.trim(), form.description.trim(), form.layout),
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
    <div className="mx-auto min-w-0 max-w-5xl space-y-5">
      <header className="page-header">
        <div>
          <h1 className="page-title">Mapas mentais</h1>
          <p className="page-subtitle">Organize ideias, links e canais em blocos conectados.</p>
        </div>

        <div className="page-actions">
          {!loading && maps.length > 0 && (
            <>
              <span className="chip">
                {maps.length} {maps.length === 1 ? "mapa" : "mapas"}
              </span>
              <span className="chip">
                {totalBlocks} {totalBlocks === 1 ? "bloco" : "blocos"}
              </span>
            </>
          )}
          <button
            type="button"
            onClick={openCreate}
            className="silver-button inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-medium"
          >
            <Plus className="h-4 w-4" /> Novo mapa
          </button>
        </div>
      </header>

      {!loading && maps.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar mapa mental..."
            className="h-10 w-full rounded-[10px] border border-border bg-card pl-9 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/35"
          />
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground animate-pulse">Carregando...</div>
      ) : maps.length === 0 ? (
        <div className="empty-state py-14">
          <Network className="h-7 w-7 text-muted-foreground/50" />
          <strong>Nenhum mapa mental</strong>
          <span>Crie um tema central e conecte ideias, perfis, links ou tarefas.</span>
          <button
            type="button"
            onClick={openCreate}
            className="mt-2 flex h-9 items-center gap-2 rounded-lg border border-border bg-secondary px-3.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            <Plus className="h-4 w-4" /> Criar primeiro mapa
          </button>
        </div>
      ) : filteredMaps.length === 0 ? (
        <div className="empty-state py-12">
          <Search className="h-6 w-6 text-muted-foreground/50" />
          <strong>Nenhum mapa encontrado</strong>
          <span>Tente outro termo na busca.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {filteredMaps.map((map) => {
            const blocks = map.data?.root ? countTopics(map.data.root) : 1;
            const rootIcon = map.data?.root?.icon;
            return (
              <div
                key={map.id}
                className="panel group relative overflow-hidden transition-colors duration-150 hover:border-foreground/25"
              >
                <button
                  type="button"
                  onClick={() => {
                    setOpenMap(map);
                    setDraft(map.data);
                  }}
                  className="w-full p-4 text-left"
                >
                  <div className="mb-3 flex items-start justify-between gap-3 pr-8">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-foreground">
                      {rootIcon && rootIcon !== "none" ? (
                        <BrandIcon name={rootIcon} className="h-4 w-4" />
                      ) : (
                        <Network className="h-4 w-4" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="chip !h-5 !px-2 !text-[11px]">
                        {blocks} {blocks === 1 ? "bloco" : "blocos"}
                      </span>
                      <span className="chip !h-5 !px-2 !text-[11px]">
                        {getMindMapLayoutLabel(map.data?.layout)}
                      </span>
                    </div>
                  </div>

                  <h3 className="truncate text-sm font-medium text-foreground">{map.title}</h3>
                  {map.description ? (
                    <p className="mt-1 line-clamp-2 min-h-8 text-xs leading-relaxed text-muted-foreground">{map.description}</p>
                  ) : (
                    <p className="mt-1 min-h-8 text-xs text-muted-foreground/55">Sem descrição</p>
                  )}

                  <div className="mt-3.5 flex items-center gap-1.5 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
                    <Clock3 className="h-3 w-3" />
                    Atualizado em {new Date(map.updated_at).toLocaleDateString("pt-BR")}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setDeleteId(map.id)}
                  className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-100 transition-colors hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
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
        <DialogContent className="max-h-[92dvh] overflow-y-auto border-border bg-card sm:max-w-3xl">
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

            <div>
              <div className="mb-3">
                <label className="block text-sm font-semibold text-foreground">Escolha a estrutura</label>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Veja o desenho e escolha a opção que mais combina com o que você quer organizar.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {MIND_MAP_LAYOUTS.map((option) => {
                  const active = form.layout === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, layout: option.id }))}
                      className={
                        active
                          ? "relative overflow-hidden rounded-xl border-2 border-foreground bg-accent/70 p-3 text-left shadow-sm"
                          : "relative overflow-hidden rounded-xl border border-border bg-secondary/20 p-3 text-left transition-all hover:border-foreground/25 hover:bg-accent/40"
                      }
                    >
                      <div className="rounded-lg border border-border/70 bg-background/55 px-2 py-1">
                        <LayoutPreview layout={option.id} />
                      </div>

                      <div className="mt-3 flex items-start justify-between gap-3">
                        <div>
                          <span className="text-sm font-semibold text-foreground">{option.label}</span>
                          <p className="mt-0.5 text-[10px] font-medium text-foreground/70">{option.useCase}</p>
                        </div>

                        <span
                          className={
                            active
                              ? "rounded-full bg-foreground px-2 py-1 text-[9px] font-semibold text-background"
                              : "rounded-full border border-border px-2 py-1 text-[9px] text-muted-foreground"
                          }
                        >
                          {active ? "Selecionado" : "Escolher"}
                        </span>
                      </div>

                      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                        {option.description}
                      </p>
                    </button>
                  );
                })}
              </div>
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
