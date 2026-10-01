import { useState } from 'react';
import { Plus, Presentation, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useSupabaseCrud } from '@/hooks/useSupabaseCrud';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SlidesEditor } from '@/features/slides/SlidesEditor';
import { emptySlides, isSlideData, type SlideRow } from '@/features/slides/types';

// The existing owner-protected mind_maps JSONB store also supports freeform canvases.
// A discriminator keeps slides out of the tree editor; no database migration is required.
export default function Slides() {
  const { user } = useAuth();
  const { data, loading, create, update, remove } = useSupabaseCrud<SlideRow>('mind_maps', 'updated_at');
  const [open, setOpen] = useState<SlideRow | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteRow, setDeleteRow] = useState<SlideRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const slides = data.filter(row => isSlideData(row.data) && row.title.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  const newBoard = async () => {
    if (creating) return;
    setCreating(true);
    try { const row = await create({ title: 'Nova apresentação', data: emptySlides() }); if (row) setOpen(row); }
    finally { setCreating(false); }
  };
  if (open && user) return <SlidesEditor key={open.id} row={open} userId={user.id} onBack={() => setOpen(null)}
    onSave={async (title, next) => !!await update(open.id, { title, data: next }, { silent: true })}
    onUpload={async file => {
      const name = file.name.replace(/[^\w.-]+/g, '_').slice(-90);
      const storagePath = `${user.id}/slides/${open.id}/${crypto.randomUUID()}-${name}`;
      const { error } = await supabase.storage.from('media').upload(storagePath, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      return { storagePath, src: supabase.storage.from('media').getPublicUrl(storagePath).data.publicUrl };
    }} />;
  return <div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card/40 p-5"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><Presentation className="h-6 w-6" />Slides</h1><p className="mt-1 text-sm text-muted-foreground">Um painel livre para criar e apresentar do seu jeito.</p></div><button disabled={creating || loading} onClick={() => void newBoard()} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"><Plus className="h-4 w-4" />{creating ? 'Criando…' : 'Nova apresentação'}</button></header>
    <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input aria-label="Buscar apresentações" placeholder="Buscar apresentações…" value={query} onChange={e => setQuery(e.target.value)} className="w-full rounded-lg border border-border bg-secondary py-2.5 pl-10 pr-4 text-sm" /></div>
    {loading ? <p className="text-sm text-muted-foreground">Carregando apresentações…</p> : !slides.length ? <div className="rounded-xl border border-dashed border-border p-12 text-center"><Presentation className="mx-auto mb-3 h-9 w-9 text-muted-foreground" /><h2 className="font-semibold">{query ? 'Nenhuma apresentação encontrada' : 'Suas ideias ganham espaço aqui'}</h2><p className="mt-2 text-sm text-muted-foreground">{query ? 'Tente outro nome.' : 'Crie um painel e adicione textos, imagens, vídeos e desenhos.'}</p></div> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{slides.map(row => <article key={row.id} className="group relative overflow-hidden rounded-xl border border-border bg-card/40"><button onClick={() => setOpen(row)} className="w-full text-left"><div className="flex h-36 items-center justify-center bg-background" style={{ backgroundImage: 'radial-gradient(hsl(0 0% 15%) 1px, transparent 1px)', backgroundSize: '26px 26px' }}><div className="rounded-xl border border-border bg-secondary px-5 py-3 shadow-lg"><Presentation className="mx-auto mb-1 h-6 w-6 text-muted-foreground" /><span className="text-xs text-muted-foreground">{row.data.nodes.length} elementos</span></div></div><div className="p-4 pr-12"><h2 className="truncate font-medium">{row.title}</h2><p className="mt-1 text-xs text-muted-foreground">Editado em {new Date(row.updated_at).toLocaleDateString('pt-BR')}</p></div></button><button aria-label={`Excluir ${row.title}`} title="Excluir apresentação" onClick={() => setDeleteRow(row)} className="absolute bottom-5 right-3 rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-destructive"><Trash2 className="h-4 w-4" /></button></article>)}</div>}
    <Dialog open={!!deleteRow} onOpenChange={v => { if (!v && !deleting) setDeleteRow(null); }}><DialogContent><DialogHeader><DialogTitle>Excluir apresentação?</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">“{deleteRow?.title}” será removida. Esta ação não pode ser desfeita.</p><div className="flex justify-end gap-2"><button disabled={deleting} className="rounded border border-border px-4 py-2" onClick={() => setDeleteRow(null)}>Cancelar</button><button disabled={deleting} className="rounded bg-destructive px-4 py-2 text-destructive-foreground" onClick={async () => {
      if (!deleteRow || !user) return;
      setDeleting(true);
      try {
        // Delete owned media only after the board is removed. Listing also includes removed/undone uploads.
        if (!await remove(deleteRow.id)) return;
        try { localStorage.removeItem(`organizafyd:slides:${user.id}:${deleteRow.id}`); } catch { /* Cache may be disabled. */ }
        const folder = `${user.id}/slides/${deleteRow.id}`;
        const { data: files, error: listError } = await supabase.storage.from('media').list(folder, { limit: 1000 });
        if (!listError && files?.length) {
          const { error } = await supabase.storage.from('media').remove(files.map(f => `${folder}/${f.name}`));
          if (error) toast.warning('Apresentação excluída. Alguns arquivos não puderam ser limpos.');
        }
        setDeleteRow(null);
      } finally { setDeleting(false); }
    }}>{deleting ? 'Excluindo…' : 'Excluir'}</button></div></DialogContent></Dialog>
  </div>;
}
