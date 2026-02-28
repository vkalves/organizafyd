import { GitBranch, Plus, Trash2, Edit2 } from "lucide-react";
import { useState } from "react";
import { useSupabaseCrud } from "@/hooks/useSupabaseCrud";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { FunnelCanvas } from "@/components/funnels/FunnelCanvas";

interface Funnel {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

const Funis = () => {
  const { data: funnels, loading, create, update, remove } = useSupabaseCrud<Funnel>("funnels");
  const [showDialog, setShowDialog] = useState(false);
  const [editFunnel, setEditFunnel] = useState<Funnel | null>(null);
  const [form, setForm] = useState({ title: "", description: "" });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [openFunnel, setOpenFunnel] = useState<Funnel | null>(null);

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
    if (editFunnel) await update(editFunnel.id, form);
    else {
      const newFunnel = await create(form);
      if (newFunnel) setOpenFunnel(newFunnel);
    }
    setShowDialog(false);
  };

  if (openFunnel) {
    return <FunnelCanvas funnelId={openFunnel.id} funnelTitle={openFunnel.title} onBack={() => setOpenFunnel(null)} />;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Funis</h1>
          <p className="text-sm text-muted-foreground mt-1">Mapas mentais e fluxogramas</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" /> Novo Funil
        </button>
      </div>

      {loading ? (
        <div className="text-center py-24 text-muted-foreground animate-pulse">Carregando...</div>
      ) : funnels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="p-4 rounded-full bg-secondary mb-4"><GitBranch className="w-8 h-8 text-muted-foreground" /></div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Nenhum funil criado</h2>
          <p className="text-sm text-muted-foreground max-w-sm">Crie seu primeiro funil para organizar seus fluxos.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {funnels.map(f => (
            <div key={f.id} className="bg-card border border-border rounded-lg p-4 hover:bg-card-hover transition-colors group cursor-pointer" onClick={() => setOpenFunnel(f)}>
              <div className="flex items-start justify-between mb-2">
                <div className="p-2 rounded-md bg-secondary"><GitBranch className="w-4 h-4 text-foreground" /></div>
                <div className="flex gap-1">
                  <button onClick={(e) => openEditMeta(f, e)} className="p-1.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100">
                    <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(f.id); }} className="p-1.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100">
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </button>
                </div>
              </div>
              <h3 className="text-sm font-medium text-foreground">{f.title}</h3>
              {f.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{f.description}</p>}
              <span className="text-[10px] text-muted-foreground mt-2 block">{new Date(f.updated_at).toLocaleDateString("pt-BR")}</span>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">{editFunnel ? "Editar" : "Novo"} Funil</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <input type="text" placeholder="Nome do funil" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <textarea placeholder="Descrição (opcional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full h-20 px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none resize-none" />
            <button onClick={handleSave} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">{editFunnel ? "Salvar" : "Criar"}</button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Confirmar exclusão</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Tem certeza? Todos os nós e conexões serão excluídos.</p>
          <div className="flex gap-2 justify-end mt-4">
            <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 rounded-md bg-secondary text-sm text-foreground">Cancelar</button>
            <button onClick={() => deleteConfirm && remove(deleteConfirm).then(() => setDeleteConfirm(null))} className="px-4 py-2 rounded-md bg-destructive text-destructive-foreground text-sm font-medium">Excluir</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Funis;
