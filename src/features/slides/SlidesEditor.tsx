import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ReactFlow, ReactFlowProvider, Background, Panel, applyNodeChanges, useReactFlow, type Viewport } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, MousePointer2, Hand, Type, ImagePlus, Video, Pencil, Eraser, Trash2, Copy, Undo2, Redo2, Maximize2, Minimize2, Plus, Minus, Scan, Save, Link2, Bold, Layers, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SlideNode } from './SlideNode';
import { SlideContext } from './context';
import { cleanNodes, drawingNode, safeMediaUrl, type SlideData, type SlideItem, type SlideNode as SlideNodeType, type SlideRow } from './types';
import './slides.css';

const nodeTypes = { slide: SlideNode };
type Tool = 'select' | 'hand' | 'pencil' | 'eraser';
type Snapshot = { title: string; data: SlideData };
type Props = { row: SlideRow; userId: string; onBack: () => void; onSave: (title: string, data: SlideData) => Promise<boolean>; onUpload: (file: File) => Promise<{ src: string; storagePath: string }> };
function IconButton({ label, children, onClick, active, disabled }: { label: string; children: ReactNode; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return <button type="button" className="slides-tool" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}>{children}</button>;
}
function Canvas({ row, userId, onBack, onSave, onUpload }: Props) {
  const placeholder = useRef<HTMLDivElement>(null);
  const [portalHost] = useState(() => document.createElement('div'));
  const cacheKey = `organizafyd:slides:${userId}:${row.id}`;
  const [initial] = useState<Snapshot>(() => {
    try { const saved = JSON.parse(localStorage.getItem(cacheKey) || 'null'); if (saved?.data?.kind === 'slides' && Array.isArray(saved.data.nodes) && saved.at > Date.parse(row.updated_at)) return saved; } catch { /* Cloud copy remains available. */ }
    return { title: row.title, data: row.data };
  });
  const [title, setTitle] = useState(initial.title);
  const [nodes, setNodes] = useState<SlideNodeType[]>(initial.data.nodes);
  const [viewport, setViewport] = useState(initial.data.viewport);
  const [tool, setTool] = useState<Tool>('select');
  const [presenting, setPresenting] = useState(false);
  useLayoutEffect(() => {
    const parent = presenting ? document.body : placeholder.current;
    parent?.appendChild(portalHost);
    return () => { portalHost.remove(); };
  }, [presenting, portalHost]);
  const [editing, setEditing] = useState<string | null>(null);
  const [color, setColor] = useState('#f4f4f5');
  const [penWidth, setPenWidth] = useState(3);
  const [ink, setInk] = useState<{ x: number; y: number }[]>([]);
  const [status, setStatus] = useState('Salvo');
  const [uploading, setUploading] = useState(false);
  const [linkKind, setLinkKind] = useState<'image' | 'video' | null>(null);
  const [link, setLink] = useState('');
  const [help, setHelp] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const history = useRef<SlideNodeType[][]>([]);
  const future = useRef<SlideNodeType[][]>([]);
  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  const stage = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const flow = useReactFlow<SlideNodeType>();
  const callbacks = useRef({ onSave, onUpload }); callbacks.current = { onSave, onUpload };
  const snapshot: Snapshot = { title, data: { kind: 'slides', version: 1, nodes: cleanNodes(nodes), viewport } };
  const serialized = JSON.stringify(snapshot);
  const latest = useRef(serialized); latest.current = serialized;
  const saved = useRef(JSON.stringify({ title: row.title, data: { ...row.data, nodes: cleanNodes(row.data.nodes) } }));
  const pending = useRef<Promise<boolean> | null>(null);
  const selected = nodes.find(n => n.selected);
  const selectedIds = nodes.filter(n => n.selected).map(n => n.id);
  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 360;

  const checkpoint = () => { history.current = [...history.current.slice(-39), cleanNodes(nodesRef.current)]; future.current = []; setHistoryVersion(v => v + 1); };
  const change = (fn: (n: SlideNodeType[]) => SlideNodeType[]) => { checkpoint(); setNodes(n => fn(n)); };
  const undo = () => { const prev = history.current.pop(); if (!prev) return; future.current.push(cleanNodes(nodesRef.current)); setNodes(prev); setEditing(null); setHistoryVersion(v => v + 1); };
  const redo = () => { const next = future.current.pop(); if (!next) return; history.current.push(cleanNodes(nodesRef.current)); setNodes(next); setEditing(null); setHistoryVersion(v => v + 1); };
  const patch = (data: Partial<SlideItem>) => change(ns => ns.map(n => n.selected ? { ...n, data: { ...n.data, ...data } } : n));
  const remove = () => { if (!selectedIds.length) return; change(ns => ns.filter(n => !n.selected)); setEditing(null); };

  async function flush(): Promise<boolean> {
    if (pending.current) return pending.current;
    const run = async () => {
      while (saved.current !== latest.current) {
        const value = latest.current;
        const next: Snapshot = JSON.parse(value);
        if (mounted.current) setStatus('Salvando…');
        try {
          const ok = await callbacks.current.onSave(next.title.trim() || 'Sem título', next.data);
          if (!ok) { if (mounted.current) setStatus('Falha ao salvar — tente novamente'); return false; }
        } catch { if (mounted.current) setStatus('Falha ao salvar — tente novamente'); return false; }
        saved.current = value;
      }
      try { localStorage.removeItem(cacheKey); } catch { /* Optional recovery cache. */ }
      if (mounted.current) setStatus('Salvo');
      return true;
    };
    pending.current = run();
    try { return await pending.current; } finally { pending.current = null; }
  }
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => {
    if (serialized === saved.current) return;
    setStatus('Alterações pendentes');
    try { localStorage.setItem(cacheKey, JSON.stringify({ ...JSON.parse(serialized), at: Date.now() })); } catch { /* beforeunload still guards cloud failures. */ }
    const timer = window.setTimeout(() => void flushRef.current(), 900);
    return () => clearTimeout(timer);
  }, [serialized, cacheKey]);
  useEffect(() => {
    mounted.current = true;
    const warn = (e: BeforeUnloadEvent) => { if (saved.current !== latest.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { mounted.current = false; window.removeEventListener('beforeunload', warn); void flushRef.current(); };
  }, []);
  useEffect(() => {
    if (!presenting) return;
    const before = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = before; };
  }, [presenting]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable=true],[role=dialog]'))) return;
      if (e.key === 'Escape') { setPresenting(false); setEditing(null); setTool('select'); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void flushRef.current(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (!presenting) { if (e.shiftKey) redo(); else undo(); } return; }
      if (!presenting && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); remove(); }
      if (e.code === 'Space' && tool !== 'pencil') e.preventDefault();
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });

  const center = () => { const r = stage.current?.getBoundingClientRect(); return flow.screenToFlowPosition({ x: (r?.left || 0) + (r?.width || 800) / 2, y: (r?.top || 0) + (r?.height || 600) / 2 }); };
  const add = (data: SlideItem, w = 420, h = 260) => {
    const p = center(); const id = crypto.randomUUID();
    change(ns => [...ns.map(n => ({ ...n, selected: false })), { id, type: 'slide', position: { x: p.x - w / 2, y: p.y - h / 2 }, style: { width: w, height: h }, selected: true, data }]);
    setTool('select'); return id;
  };
  const addText = () => { const id = add({ kind: 'text', text: 'Escreva sua ideia', fontSize: 36, bold: true, color: '#f4f4f5', background: '#18181b' }); setEditing(id); };
  const addMedia = (kind: 'image' | 'video', src: string, name: string, storagePath?: string) => add({ kind, src, storagePath, name, fontSize: 24, color: '#f4f4f5', background: 'transparent' }, 480, 300);
  const upload = async (files: FileList | null) => {
    if (!files?.length || uploading) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!/^(image\/(jpeg|png|webp|gif|avif)|video\/(mp4|webm|ogg|quicktime))$/.test(file.type)) { toast.error(`Formato não aceito: ${file.name}`); continue; }
        if (file.size > 50 * 1024 * 1024) { toast.error(`${file.name}: o limite é 50 MB por arquivo.`); continue; }
        try { const media = await callbacks.current.onUpload(file); if (mounted.current) addMedia(file.type.startsWith('image/') ? 'image' : 'video', media.src, file.name, media.storagePath); }
        catch { toast.error(`Não foi possível enviar ${file.name}. Tente novamente.`); }
      }
    } finally { if (mounted.current) setUploading(false); }
  };
  const duplicate = () => change(ns => [...ns.map(n => ({ ...n, selected: false })), ...ns.filter(n => n.selected).map(n => ({ ...n, id: crypto.randomUUID(), selected: true, position: { x: n.position.x + 35, y: n.position.y + 35 } }))]);
  const focus = (n: SlideNodeType) => { if (tool !== 'eraser') void flow.fitView({ nodes: [{ id: n.id }], padding: .16, duration, maxZoom: 2.5 }); };
  const setPresentation = () => { setPresenting(v => !v); setEditing(null); setTool('hand'); setNodes(ns => ns.map(n => ({ ...n, selected: false }))); };
  const point = (e: { clientX: number; clientY: number }) => flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
  const inkRef = useRef<{ x: number; y: number }[]>([]);

  const content = <div className={`slides-editor ${presenting ? 'is-presenting' : ''}`} data-testid="slides-editor">
    {!presenting && <header className="slides-header">
      <IconButton label="Voltar aos slides" disabled={uploading} onClick={async () => { if (await flush()) onBack(); }}><ArrowLeft /></IconButton>
      <input aria-label="Título da apresentação" maxLength={140} value={title} onChange={e => setTitle(e.target.value)} className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none" />
      <span role="status" className="text-xs text-muted-foreground">{uploading ? 'Enviando arquivo…' : status}</span>
      <IconButton label="Salvar agora" onClick={() => void flush()}><Save /></IconButton>
      <button className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm" onClick={setPresentation}>Apresentar</button>
    </header>}
    <div ref={stage} className="slides-stage" onDragOver={e => { if (!presenting) e.preventDefault(); }} onDrop={e => { if (!presenting) { e.preventDefault(); void upload(e.dataTransfer.files); } }}>
      <ReactFlow<SlideNodeType> nodes={nodes} edges={[]} nodeTypes={nodeTypes}
        defaultViewport={initial.data.viewport} minZoom={.05} maxZoom={5}
        onNodesChange={changes => setNodes(ns => applyNodeChanges(changes, ns))}
        onNodeDragStart={checkpoint} onSelectionDragStart={checkpoint}
        onMoveEnd={(_, v: Viewport) => setViewport(v)}
        nodesDraggable={!presenting && tool === 'select'} nodesConnectable={false}
        elementsSelectable={!presenting && (tool === 'select' || tool === 'eraser')}
        panOnDrag={tool === 'hand' || presenting ? true : [1, 2]}
        selectionOnDrag={!presenting && tool === 'select'} panActivationKeyCode="Space"
        zoomOnScroll zoomOnPinch zoomOnDoubleClick={false} deleteKeyCode={null}
        onPaneClick={() => setEditing(null)}
        onNodeClick={(_, n) => { if (tool === 'eraser') change(ns => ns.filter(item => item.id !== n.id)); }}
        onNodeDoubleClick={(_, n) => { if (presenting || n.data.kind !== 'text') focus(n); }}
        className="bg-background" aria-label="Painel livre de slides">
        <Background color="hsl(0 0% 15%)" gap={26} size={1} />
      {tool === 'pencil' && <svg className="slides-ink" width="100%" height="100%" aria-label="Área para desenhar"
        onPointerDown={e => { if (e.button !== 0 || !e.isPrimary) return; e.currentTarget.setPointerCapture(e.pointerId); inkRef.current = [point(e)]; setInk(inkRef.current); }}
        onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; inkRef.current = [...inkRef.current, point(e)]; setInk(inkRef.current); }}
        onPointerUp={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; e.currentTarget.releasePointerCapture(e.pointerId); if (inkRef.current.length) { const node = drawingNode(inkRef.current, color, penWidth); change(ns => [...ns, node]); } inkRef.current = []; setInk([]); }}
        onPointerCancel={() => { inkRef.current = []; setInk([]); }}>
        <g transform={`translate(${flow.getViewport().x},${flow.getViewport().y}) scale(${flow.getViewport().zoom})`}><polyline points={ink.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth={penWidth} strokeLinecap="round" strokeLinejoin="round" /></g>
      </svg>}
        {!nodes.length && !presenting && <Panel position="top-center"><div className="pointer-events-none mt-16 text-center text-muted-foreground"><p className="text-xl font-semibold text-foreground">Uma tela. Todas as suas ideias.</p><p className="mt-2 text-sm">Adicione textos, imagens e vídeos pelos botões abaixo.</p><p className="mt-1 text-xs">Arraste arquivos para cá ou comece com um texto.</p></div></Panel>}
        {!presenting && selected && <Panel position="top-left"><div className="slides-properties">
          {selected.data.kind === 'text' && <>
            <IconButton label="Editar texto" onClick={() => { checkpoint(); setEditing(selected.id); }}><Type /></IconButton>
            <label>Tamanho <input aria-label="Tamanho do texto" type="number" min={12} max={160} value={selected.data.fontSize} onChange={e => patch({ fontSize: Math.max(12, Math.min(160, +e.target.value || 12)) })} /></label>
            <IconButton label="Negrito" active={!!selected.data.bold} onClick={() => patch({ bold: !selected.data.bold })}><Bold /></IconButton>
            <select aria-label="Alinhamento do texto" value={selected.data.align || 'left'} onChange={e => patch({ align: e.target.value as SlideItem['align'] })}><option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option></select>
          </>}
          {(selected.data.kind === 'text' || selected.data.kind === 'drawing') && <label title="Cor">Cor <input aria-label="Cor do conteúdo" type="color" value={selected.data.color} onChange={e => patch({ color: e.target.value })} /></label>}
          {selected.data.kind === 'text' && <><label>Fundo <input aria-label="Cor de fundo do texto" type="color" value={selected.data.background === 'transparent' ? '#18181b' : selected.data.background} onChange={e => patch({ background: e.target.value })} /></label><button onClick={() => patch({ background: selected.data.background === 'transparent' ? '#18181b' : 'transparent' })}>Sem fundo</button></>}
          <IconButton label="Aproximar conteúdo" onClick={() => focus(selected)}><Scan /></IconButton>
          <IconButton label="Trazer para frente" onClick={() => change(ns => ns.map(n => n.selected ? { ...n, zIndex: Math.max(0, ...ns.map(i => i.zIndex || 0)) + 1 } : n))}><Layers /></IconButton>
          <IconButton label="Duplicar seleção" onClick={duplicate}><Copy /></IconButton><IconButton label="Remover seleção" onClick={remove}><Trash2 /></IconButton>
        </div></Panel>}
        {tool === 'pencil' && <Panel position="top-right"><div className="slides-properties"><input type="color" aria-label="Cor do lápis" value={color} onChange={e => setColor(e.target.value)} /><label>Traço <input type="number" aria-label="Espessura do lápis" min={1} max={24} value={penWidth} onChange={e => setPenWidth(Math.max(1, Math.min(24, +e.target.value || 1)))} /></label></div></Panel>}
        {!presenting && <Panel position="bottom-left"><p className="slides-help">Roda do mouse: zoom · Espaço + arrastar: mover<br />Duplo clique: editar texto ou aproximar mídia</p></Panel>}
        <Panel position="bottom-right"><div className="slides-tools">
          {!presenting && <>
            <IconButton label="Selecionar e mover objetos" active={tool === 'select'} onClick={() => setTool('select')}><MousePointer2 /></IconButton>
            <IconButton label="Adicionar texto" onClick={addText}><Type /></IconButton>
            <IconButton label="Adicionar imagens" disabled={uploading} onClick={() => imageInput.current?.click()}><ImagePlus /></IconButton>
            <IconButton label="Adicionar vídeos" disabled={uploading} onClick={() => videoInput.current?.click()}><Video /></IconButton>
            <IconButton label="Adicionar mídia por link" onClick={() => { setLink(''); setLinkKind('image'); }}><Link2 /></IconButton>
          </>}
          <IconButton label="Mover painel" active={tool === 'hand'} onClick={() => setTool('hand')}><Hand /></IconButton>
          <IconButton label="Lápis" active={tool === 'pencil'} onClick={() => setTool(t => t === 'pencil' ? 'hand' : 'pencil')}><Pencil /></IconButton>
          {!presenting && <>
            <IconButton label="Borracha: remover objeto" active={tool === 'eraser'} onClick={() => setTool('eraser')}><Eraser /></IconButton>
            <IconButton label="Desfazer" disabled={!history.current.length} onClick={undo}><Undo2 /></IconButton>
            <IconButton label="Refazer" disabled={!future.current.length} onClick={redo}><Redo2 /></IconButton>
          </>}
          <IconButton label="Diminuir zoom" onClick={() => void flow.zoomOut({ duration })}><Minus /></IconButton>
          <IconButton label="Aumentar zoom" onClick={() => void flow.zoomIn({ duration })}><Plus /></IconButton>
          <IconButton label="Ver todo o painel" onClick={() => void flow.fitView({ padding: .18, duration })}><Scan /></IconButton>
          {!presenting && <IconButton label="Como usar" onClick={() => setHelp(true)}><HelpCircle /></IconButton>}
          <IconButton label={presenting ? 'Sair da apresentação' : 'Apresentar em tela inteira'} onClick={setPresentation}>{presenting ? <Minimize2 /> : <Maximize2 />}</IconButton>
        </div></Panel>
      </ReactFlow>

    </div>
    <input hidden multiple ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" onChange={e => { void upload(e.target.files); e.target.value = ''; }} />
    <input hidden multiple ref={videoInput} type="file" accept="video/mp4,video/webm,video/ogg,video/quicktime" onChange={e => { void upload(e.target.files); e.target.value = ''; }} />
    <Dialog open={!!linkKind} onOpenChange={open => { if (!open) setLinkKind(null); }}><DialogContent><DialogHeader><DialogTitle>Adicionar mídia por link</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">Use o endereço direto de uma imagem ou vídeo. Links de páginas do YouTube e Instagram não são arquivos de vídeo.</p><select className="rounded border border-border bg-secondary p-2" aria-label="Tipo de mídia" value={linkKind || 'image'} onChange={e => setLinkKind(e.target.value as 'image' | 'video')}><option value="image">Imagem</option><option value="video">Vídeo</option></select><input aria-label="Endereço da mídia" placeholder="https://…" className="rounded border border-border bg-secondary p-2" value={link} onChange={e => setLink(e.target.value)} /><button className="rounded bg-primary p-2 text-primary-foreground" onClick={() => { const url = safeMediaUrl(link); if (!url) return toast.error('Informe um endereço http ou https válido.'); addMedia(linkKind!, url, 'Mídia por link'); setLinkKind(null); }}>Adicionar</button></DialogContent></Dialog>
    <Dialog open={help} onOpenChange={setHelp}><DialogContent><DialogHeader><DialogTitle>Seu painel livre</DialogTitle></DialogHeader><ul className="list-disc space-y-2 pl-4 text-sm"><li>Adicione textos, imagens e vídeos. Arraste os objetos e ajuste o tamanho pelos cantos.</li><li>Use a mão para puxar o painel em qualquer direção. Também funciona segurando Espaço.</li><li>Use a roda do mouse ou o gesto de pinça para aproximar e afastar.</li><li>Dê dois cliques em um texto para editar. Na apresentação, dois cliques aproximam qualquer bloco.</li><li>Use o lápis para desenhar e a borracha para remover um objeto inteiro.</li><li>Apresentar esconde os menus. Aperte Esc para sair.</li><li>Suas mudanças são salvas automaticamente. Ctrl+Z desfaz; Ctrl+Shift+Z refaz.</li></ul></DialogContent></Dialog>
  </div>;
  void historyVersion;
  return <SlideContext.Provider value={{ presenting, editing, edit: setEditing, checkpoint, patch: (id, text) => setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, text } } : n)) }}><div ref={placeholder} />{createPortal(content, portalHost)}</SlideContext.Provider>;
}
// Keep one portal host stable so entering presentation never remounts the canvas or interrupts videos.

export function SlidesEditor(props: Props) { return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>; }
