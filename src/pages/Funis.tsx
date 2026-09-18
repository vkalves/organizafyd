import { Edit2, GitBranch, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { FunnelCanvas } from "@/components/funnels/FunnelCanvas";
import { formatDate } from "@/lib/date";

interface Funnel {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

const Funis = () => {
  const { data: funnels, loading, create, update, remove, mutating } = useSupabaseCrud<Funnel>("funnels");
  const [showDialog, setShowDialog] = useState(false);
  const [editFunnel, setEditFunnel] = useState<Funnel | null>(null);
  const [form, setForm] = useState({ title: "", description: "" });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [openFunnel, setOpenFunnel] = useState<Funnel | null>(null);
  const [search, setSearch] = useState("");

  const filteredFunnels = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return funnels;
    return funnels.filter((funnel) => `${funnel.title} ${funnel.description || ""}`.toLocaleLowerCase("pt-BR").includes(term));
  }, [funnels, search]);

  const openCreate = () => {
    setEditFunnel(null);
    setForm({ title: "", description: "" });
    setShowDialog(true);
  };

  const openEditMeta = (f: Funnel, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditFunnel(f);
    setForm({ title: f.title, description: f.description || "" });
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return toast.error("Título obrigatório");
    if (editFunnel) {
      const updated = await update(editFunnel.id, { title: form.title.trim(), description: form.description.trim() || null });
      if (!updated) return;
    } else {
      const newFunnel = await create(form);
      if (newFunnel) setOpenFunnel(newFunnel);
    }
    setShowDialog(false);
  };

  if (openFunnel) {
    return <FunnelCanvas funnelId={openFunnel.id} funnelTitle={openFunnel.title} onBack={() => setOpenFunnel(null)} />;
  }

  return (
    <div className="page-shell max-w-6xl">
      <header className="page-header">
        <div>
          <p className="eyebrow"><GitBranch className="h-3.5 w-3.5" /> Visualização</p>
          <h1 className="page-title">Funis</h1>
          <p className="page-description">Mapeie jornadas, processos e fluxos de conversão.</p>
        </div>
        <button type="button" onClick={openCreate} className="action-primary">
          <Plus className="h-4 w-4" aria-hidden="true" /> Novo funil
        </button>
      </header>

      {funnels.length > 0 && (
        <div className="toolbar-panel">
          <label className="relative flex-1" htmlFor="funnel-search">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input id="funnel-search" className="field pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar funis…" />
          </label>
          <span className="text-xs text-muted-foreground">{filteredFunnels.length} de {funnels.length}</span>
        </div>
      )}

      {loading ? (
        <div className="text-center py-24 text-muted-foreground animate-pulse">Carregando...</div>
      ) : funnels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="p-4 rounded-full bg-secondary mb-4"><GitBranch className="w-8 h-8 text-muted-foreground" /></div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Nenhum funil criado</h2>
          <p className="text-sm text-muted-foreground max-w-sm">Crie seu primeiro funil para organizar seus fluxos.</p>
        </div>
      ) : filteredFunnels.length === 0 ? (
        <div className="empty-state"><Search className="h-6 w-6 text-muted-foreground" /><h2>Nenhum funil encontrado</h2><p>Tente buscar por outro nome.</p></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredFunnels.map(f => (
            <article key={f.id} className="surface-card group cursor-pointer p-4 transition-colors hover:border-primary/40" onClick={() => setOpenFunnel(f)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpenFunnel(f); } }} role="button" tabIndex={0}>
              <div className="flex items-start justify-between mb-2">
                <div className="rounded-xl bg-primary/10 p-2 text-primary"><GitBranch className="h-4 w-4" aria-hidden="true" /></div>
                <div className="flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                  <button type="button" onClick={(e) => openEditMeta(f, e)} aria-label={`Editar ${f.title}`} className="icon-button">
                    <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(f.id); }} aria-label={`Excluir ${f.title}`} className="icon-button text-destructive hover:bg-destructive/10">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <h3 className="font-medium text-foreground">{f.title}</h3>
              {f.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{f.description}</p>}
              <span className="mt-4 block text-xs text-muted-foreground">Atualizado em {formatDate(f.updated_at)}</span>
            </article>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">{editFunnel ? "Editar" : "Novo"} Funil</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="form-field"><label htmlFor="funnel-title">Nome</label><input className="field" id="funnel-title" type="text" placeholder="Ex.: Funil de vendas" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="form-field"><label htmlFor="funnel-description">Descrição <span>(opcional)</span></label><textarea className="field h-24 py-2" id="funnel-description" placeholder="Para que este funil serve?" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <button type="button" onClick={handleSave} disabled={mutating} className="action-primary w-full justify-center">{mutating ? "Salvando…" : editFunnel ? "Salvar alterações" : "Criar funil"}</button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Confirmar exclusão</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Tem certeza? Todos os nós e conexões serão excluídos.</p>
          <div className="flex gap-2 justify-end mt-4">
            <button type="button" onClick={() => setDeleteConfirm(null)} className="action-secondary">Cancelar</button>
            <button type="button" onClick={async () => { if (deleteConfirm && await remove(deleteConfirm)) setDeleteConfirm(null); }} disabled={mutating} className="action-danger">{mutating ? "Excluindo…" : "Excluir"}</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Funis;
