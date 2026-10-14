import { useRef, useState } from 'react';
import { Plus, Presentation, Search, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useSupabaseCrud } from '@/hooks/useSupabaseCrud';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { readSlideFile } from '@/features/slides/import';
import { SlidePreview } from '@/features/slides/SlidePreview';
import { SlidesEditor } from '@/features/slides/SlidesEditor';
import { emptySlides, isSlideData, type SlideRow } from '@/features/slides/types';

// The existing owner-protected mind_maps JSONB store also supports freeform canvases.
// A discriminator keeps slides out of the tree editor; no database migration is required.
export default function Slides() {
  const { user } = useAuth();
  const { data, loading, create, update, remove } = useSupabaseCrud<SlideRow>('mind_maps', 'updated_at');
  const [open, setOpen] = useState<SlideRow | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const importingRef = useRef(false);
  const [importing, setImporting] = useState(false);
  const [importedId, setImportedId] = useState<string | null>(null);
  const [importError, setImportError] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [creating, setCreating] = useState(false);
  const [deleteRow, setDeleteRow] = useState<SlideRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const slides = data.filter(row => isSlideData(row.data) && row.title.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))).sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, 'pt-BR') : sort === 'elements' ? b.data.nodes.length - a.data.nodes.length : Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const newBoard = async () => {
    if (creating) return;
    setCreating(true);
    try { const row = await create({ title: 'Nova apresentação', data: emptySlides() }); if (row) setOpen(row); }
    finally { setCreating(false); }
  };
  const importFile = async (files: FileList | null) => {
    if (!files?.length || importingRef.current || creating || loading) return;
    if (files.length !== 1) { setImportError('Importe uma apresentação por vez.'); return; }
    importingRef.current = true;
    setImporting(true);
    setImportError('');
    try {
      const presentation = await readSlideFile(files[0]);
      const row = await create(presentation);
      if (!row) throw new Error('Não foi possível salvar a apresentação. Tente novamente.');
      setImportedId(row.id);
      setOpen(row);
      toast.success('Slide importado. Todos os elementos estão prontos para editar.');
    } catch (error) { setImportError(error instanceof Error ? error.message : 'Não foi possível importar esse arquivo.'); }
    finally { importingRef.current = false; setImporting(false); }
  };
  if (open && user) return <SlidesEditor key={open.id} row={open} userId={user.id} fitOnOpen={importedId === open.id} onBack={() => { setOpen(null); setImportedId(null); }}
    onSave={async (title, next) => !!await update(open.id, { title, data: next }, { silent: true })}
    onUpload={async file => {
      const name = file.name.replace(/[^\w.-]+/g, '_').slice(-90);
      const storagePath = `${user.id}/slides/${open.id}/${crypto.randomUUID()}-${name}`;
      const { error } = await supabase.storage.from('media').upload(storagePath, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      return { storagePath, src: supabase.storage.from('media').getPublicUrl(storagePath).data.publicUrl };
    }} />;
  return <div className="mx-auto min-w-0 max-w-6xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/70 pb-6">
      <div>
        <p className="page-eyebrow mb-2">Espaço criativo</p>
        <h1 className="text-3xl font-medium tracking-tight">Slides</h1>
        <p className="mt-1 text-sm text-muted-foreground">Um painel livre para criar e apresentar do seu jeito.</p>
      </div>
      <button disabled={creating || importing || loading} onClick={() => void newBoard()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50 sm:w-auto"><Plus className="h-4 w-4" />{creating ? 'Criando…' : 'Nova apresentação'}</button>
    </header>
    <section className="operation-panel rounded-2xl p-5 sm:p-6" aria-label="Importar slide" onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={e => { e.preventDefault(); void importFile(e.dataTransfer.files); }}>
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-medium">Importar slide</h2><p className="mt-1 text-sm text-muted-foreground">Arraste aqui o arquivo criado pelo ChatGPT ou escolha no computador.</p><p className="mt-1 text-xs text-muted-foreground">Formato Organizafyd (.json) · Até 10 MB · Cria uma nova apresentação editável.</p></div><button disabled={importing || creating || loading} onClick={() => importInput.current?.click()} className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm font-medium disabled:opacity-50"><Upload className="h-4 w-4" />{importing ? 'Importando…' : 'Escolher arquivo'}</button></div>
      <input ref={importInput} hidden type="file" accept=".json,application/json" aria-label="Arquivo de slide" onChange={e => { void importFile(e.target.files); e.target.value = ''; }} />
      <a href="/templates/slide-organizafyd.json" download className="mt-3 inline-block text-xs text-muted-foreground underline underline-offset-4">Baixar arquivo modelo</a>
      {importing && <p role="status" className="mt-3 text-sm text-muted-foreground">Preparando e salvando sua apresentação…</p>}
      {importError && <p role="alert" className="mt-3 text-sm text-destructive">{importError}</p>}
    </section>
    <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input aria-label="Buscar apresentações" placeholder="Buscar apresentações…" value={query} onChange={e => setQuery(e.target.value)} className="w-full rounded-lg border border-border bg-secondary py-2.5 pl-10 pr-4 text-sm" /></div>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{slides.length} {slides.length === 1 ? 'apresentação' : 'apresentações'}</p><select aria-label="Ordenar apresentações" value={sort} onChange={e => setSort(e.target.value)} className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm"><option value="recent">Editadas recentemente</option><option value="name">Nome: A–Z</option><option value="elements">Mais elementos</option></select></div>
    {loading ? <p className="text-sm text-muted-foreground">Carregando apresentações…</p> : !slides.length ? <div className="operation-panel rounded-2xl p-12 text-center"><Presentation className="mx-auto mb-3 h-9 w-9 text-muted-foreground" /><h2 className="font-medium">{query ? 'Nenhuma apresentação encontrada' : 'Suas ideias ganham espaço aqui'}</h2><p className="mt-2 text-sm text-muted-foreground">{query ? 'Tente outro nome.' : 'Crie um painel e adicione textos, imagens, vídeos e desenhos.'}</p></div> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{slides.map(row => <article key={row.id} className="operation-panel group relative overflow-hidden rounded-2xl transition-colors hover:border-foreground/25"><button onClick={() => setOpen(row)} className="w-full text-left"><div className="flex h-36 items-center justify-center bg-background" style={{ backgroundColor: row.data.background, backgroundImage: row.data.showGrid === false ? 'none' : 'radial-gradient(hsl(0 0% 15%) 1px, transparent 1px)', backgroundSize: '26px 26px' }}><SlidePreview nodes={row.data.nodes} /></div><div className="p-5 pr-12"><h2 className="truncate font-medium">{row.title}</h2><p className="mt-1 text-xs text-muted-foreground">{row.data.nodes.length} elementos · Editado em {new Date(row.updated_at).toLocaleDateString('pt-BR')}</p></div></button><button aria-label={`Excluir ${row.title}`} title="Excluir apresentação" onClick={() => setDeleteRow(row)} className="absolute bottom-5 right-3 rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-destructive"><Trash2 className="h-4 w-4" /></button></article>)}</div>}
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
