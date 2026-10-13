import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ReactFlow, ReactFlowProvider, Background, Panel, applyNodeChanges, useReactFlow, type Viewport } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, MousePointer2, Hand, Type, ImagePlus, Video, Pencil, Eraser, Trash2, Copy, Undo2, Redo2, Maximize2, Minimize2, Plus, Minus, Scan, Save, Link2, Bold, Layers, HelpCircle, MoreHorizontal, ArrowLeftRight, ArrowUpDown, AlignCenter, SquarePen, LayoutGrid, Shapes, X, ArrowDownToLine } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { SlideNode } from './SlideNode';
import { SlideContext } from './context';
import { cleanNodes, drawingNode, safeMediaUrl, fitMediaNode, type SlideData, type SlideItem, type SlideNode as SlideNodeType, type SlideRow } from './types';
import { BrandIcon, MIND_ICONS } from '../mindmap/BrandIcons';
import { alignSlideNodesCenter, centerSlideNodes, arrangeSlideNodes } from './layout';
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
  const [editingFullscreen, setEditingFullscreen] = useState(false);
  const fullscreen = presenting || editingFullscreen;
  const [controlsHidden, setControlsHidden] = useState(false);
  useLayoutEffect(() => {
    const parent = fullscreen ? document.body : placeholder.current;
    parent?.appendChild(portalHost);
    return () => { portalHost.remove(); };
  }, [fullscreen, portalHost]);
  const [editing, setEditing] = useState<string | null>(null);
  const [color, setColor] = useState('#f4f4f5');
  const [penWidth, setPenWidth] = useState(3);
  const [ink, setInk] = useState<{ x: number; y: number }[]>([]);
  const [status, setStatus] = useState('Salvo');
  const [uploading, setUploading] = useState(false);
  const [linkKind, setLinkKind] = useState<'image' | 'video' | null>(null);
  const [link, setLink] = useState('');
  const [logosOpen, setLogosOpen] = useState(false);
  const [logoQuery, setLogoQuery] = useState('');
  const [elementsOpen, setElementsOpen] = useState(false);
  const [elementQuery, setElementQuery] = useState('');
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

  const mediaSize = (id: string, src: string | undefined, width: number, height: number) => {
    const fit = (items: SlideNodeType[]) => {
      let changed = false;
      const next = items.map(node => {
        const fitted = node.id === id && node.data.src === src ? fitMediaNode(node, width, height) : node;
        if (fitted !== node) changed = true;
        return fitted;
      });
      return changed ? next : items;
    };
    setNodes(fit);
    // Loading dimensions is not an editing action. Keep undo/redo frames consistent.
    history.current = history.current.map(fit);
    future.current = future.current.map(fit);
  };
  const checkpoint = () => { history.current = [...history.current.slice(-39), cleanNodes(nodesRef.current)]; future.current = []; setHistoryVersion(v => v + 1); };
  const change = (fn: (n: SlideNodeType[]) => SlideNodeType[]) => { checkpoint(); setNodes(n => fn(n)); };
  const centerCollection = (direction: 'horizontal' | 'vertical') => {
    const result = centerSlideNodes(nodesRef.current, direction, center());
    if (!result.bounds) return;
    checkpoint();
    setEditing(null);
    setNodes(result.nodes);
  };
  const alignCollection = () => {
    if (!nodesRef.current.length) return;
    const targetX = center().x;
    setEditing(null);
    change(items => alignSlideNodesCenter(items, targetX));
  };
  const undo = () => { const prev = history.current.pop(); if (!prev) return; future.current.push(cleanNodes(nodesRef.current)); setNodes(prev); setEditing(null); setHistoryVersion(v => v + 1); };
  const redo = () => { const next = future.current.pop(); if (!next) return; history.current.push(cleanNodes(nodesRef.current)); setNodes(next); setEditing(null); setHistoryVersion(v => v + 1); };
  const patch = (data: Partial<SlideItem>) => change(ns => ns.map(n => n.selected ? { ...n, data: { ...n.data, ...data } } : n));
  const setTextSize = (value: number, recordHistory = true) => {
    const fontSize = Math.max(12, Math.min(160, Math.round(value)));
    if (recordHistory) checkpoint();
    setNodes(items => items.map(node => node.selected && node.data.kind === 'text' ? { ...node, data: { ...node.data, fontSize } } : node));
  };
  const arrange = (mode: 'row' | 'column' | 'grid') => { setEditing(null); change(ns => arrangeSlideNodes(ns, mode)); };
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
    if (!fullscreen) return;
    const before = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = before; };
  }, [fullscreen]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable=true],[role=dialog]'))) return;
      if (e.key === 'Escape') { setPresenting(false); setEditingFullscreen(false); setControlsHidden(false); setEditing(null); setTool('select'); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void flushRef.current(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (!presenting && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
      if (!presenting && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setNodes(ns => ns.map(n => ({ ...n, selected: true }))); return; }
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
        catch (error) { const detail = error instanceof Error ? error.message : (error && typeof error === "object" && "message" in error ? String(error.message) : "Tente novamente."); toast.error(`Não foi possível enviar ${file.name}: ${detail}`); }
      }
    } finally { if (mounted.current) setUploading(false); }
  };
  const duplicate = () => change(ns => [...ns.map(n => ({ ...n, selected: false })), ...ns.filter(n => n.selected).map(n => ({ ...n, id: crypto.randomUUID(), selected: true, position: { x: n.position.x + 35, y: n.position.y + 35 } }))]);
  const focus = (n: SlideNodeType) => { if (tool !== 'eraser') void flow.fitView({ nodes: [{ id: n.id }], padding: .16, duration, maxZoom: 2.5 }); };
  const setPresentation = () => { setControlsHidden(false); setPresenting(v => !v); setEditing(null); setTool('hand'); setNodes(ns => ns.map(n => ({ ...n, selected: false }))); };
  const point = (e: { clientX: number; clientY: number }) => flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
  const inkRef = useRef<{ x: number; y: number }[]>([]);

  const content = <div className={`slides-editor ${fullscreen ? 'is-fullscreen' : ''} ${presenting ? 'is-presenting' : ''}`} data-testid="slides-editor">
    {!presenting && <header className="slides-header">
      <IconButton label="Voltar aos slides" disabled={uploading} onClick={async () => { if (await flush()) onBack(); }}><ArrowLeft /></IconButton>
      <input aria-label="Título da apresentação" maxLength={140} value={title} onChange={e => setTitle(e.target.value)} className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none" />
      <span role="status" className="slides-save-status text-xs text-muted-foreground">{uploading ? 'Enviando arquivo…' : status}</span>
      <IconButton label="Salvar agora" onClick={() => void flush()}><Save /></IconButton>
      <button className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm" onClick={setPresentation}>Apresentar</button>
    </header>}
    {!presenting && !controlsHidden && <div className="slides-quickbar">
      <button onClick={addText}><Type />Texto</button>
      <button disabled={uploading} onClick={() => imageInput.current?.click()}><ImagePlus />Imagem</button>
      <button disabled={uploading} onClick={() => videoInput.current?.click()}><Video />Vídeo</button>
      <button onClick={() => { setLogoQuery(''); setLogosOpen(true); }}><Shapes />Logos</button>
      <span className="slides-toolbar-divider" />
      <button aria-pressed={elementsOpen} onClick={() => setElementsOpen(v => !v)}><Layers />Elementos <span>{nodes.length}</span></button>
      <DropdownMenu modal={false}><DropdownMenuTrigger asChild><button><LayoutGrid />Organizar</button></DropdownMenuTrigger>
        <DropdownMenuContent className="slides-toolbar-dropdown z-[120]">
          <DropdownMenuItem disabled={(selectedIds.length || nodes.length) < 2} onSelect={() => arrange('row')}>Organizar em linha</DropdownMenuItem>
          <DropdownMenuItem disabled={(selectedIds.length || nodes.length) < 2} onSelect={() => arrange('column')}>Organizar em coluna</DropdownMenuItem>
          <DropdownMenuItem disabled={(selectedIds.length || nodes.length) < 2} onSelect={() => arrange('grid')}>Organizar em grade</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setNodes(ns => ns.map(n => ({ ...n, selected: true })))}>Selecionar todos</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void flow.fitView({ padding: .18, duration })}>Enquadrar todos</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="slides-selection-count">{selectedIds.length ? `${selectedIds.length} selecionado(s)` : 'Selecione um elemento para editar'}</span>
    </div>}
            {!controlsHidden && !presenting && selected && <div className="slides-properties">
          {selected.data.kind === 'text' && <>
            <IconButton label="Editar texto" onClick={() => { checkpoint(); setEditing(selected.id); }}><Type /></IconButton>
            <div className="slide-font-size" role="group" aria-label="Ajustar tamanho do texto">
              <span>Tamanho</span>
              <IconButton label="Diminuir texto" disabled={selected.data.fontSize <= 12} onClick={() => setTextSize(selected.data.fontSize - 2)}><Minus /></IconButton>
              <input className="slide-font-range" aria-label="Tamanho do texto" type="range" min={12} max={160} step={1} value={selected.data.fontSize} onPointerDown={checkpoint} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) checkpoint(); }} onChange={e => setTextSize(+e.target.value, false)} />
              <IconButton label="Aumentar texto" disabled={selected.data.fontSize >= 160} onClick={() => setTextSize(selected.data.fontSize + 2)}><Plus /></IconButton>
              <span className="slide-font-value" aria-label="Tamanho atual do texto">{selected.data.fontSize} px</span>
            </div>
            <IconButton label="Negrito" active={!!selected.data.bold} onClick={() => patch({ bold: !selected.data.bold })}><Bold /></IconButton>
            <select aria-label="Alinhamento do texto" value={selected.data.align || 'left'} onChange={e => patch({ align: e.target.value as SlideItem['align'] })}><option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option></select>
          </>}
          {(selected.data.kind === 'text' || selected.data.kind === 'drawing' || selected.data.kind === 'logo') && <label title="Cor">Cor <input aria-label="Cor do conteúdo" type="color" value={selected.data.color} onChange={e => patch({ color: e.target.value })} /></label>}
          {selected.data.kind === 'text' && <><label>Fundo <input aria-label="Cor de fundo do texto" type="color" value={selected.data.background === 'transparent' ? '#18181b' : selected.data.background} onChange={e => patch({ background: e.target.value })} /></label><button onClick={() => patch({ background: selected.data.background === 'transparent' ? '#18181b' : 'transparent' })}>Sem fundo</button></>}
          <IconButton label="Aproximar conteúdo" onClick={() => focus(selected)}><Scan /></IconButton>
          <IconButton label="Trazer para frente" onClick={() => change(ns => ns.map(n => n.selected ? { ...n, zIndex: Math.max(0, ...ns.map(i => i.zIndex || 0)) + 1 } : n))}><Layers /></IconButton>
          <IconButton label="Enviar para trás" onClick={() => change(ns => ns.map(n => n.selected ? { ...n, zIndex: Math.min(0, ...ns.map(i => i.zIndex || 0)) - 1 } : n))}><ArrowDownToLine /></IconButton>
          <IconButton label="Duplicar seleção" onClick={duplicate}><Copy /></IconButton><IconButton label="Remover seleção" onClick={remove}><Trash2 /></IconButton>
        </div>}

    <div className="slides-workspace">
    {!presenting && !controlsHidden && elementsOpen && <aside className="slides-elements" aria-label="Elementos do slide">
      <div className="slides-elements-heading"><strong>Elementos</strong><IconButton label="Fechar elementos" onClick={() => setElementsOpen(false)}><X /></IconButton></div>
      <input aria-label="Buscar elementos" placeholder="Buscar elementos…" value={elementQuery} onChange={e => setElementQuery(e.target.value)} />
      <p>Clique para selecionar. Duplo clique para localizar.</p>
      <div className="slides-element-list">{[...nodes].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0)).filter(n => (n.data.name || n.data.text || n.data.kind).toLocaleLowerCase('pt-BR').includes(elementQuery.toLocaleLowerCase('pt-BR'))).map((n, index) => <button key={n.id} aria-pressed={!!n.selected} onClick={e => { setEditing(null); setTool('select'); setNodes(ns => ns.map(item => ({ ...item, selected: item.id === n.id ? (e.shiftKey ? !item.selected : true) : (e.shiftKey ? item.selected : false) }))); }} onDoubleClick={() => focus(n)}>
        <span className="slides-element-icon">{n.data.kind === 'logo' ? <BrandIcon name={n.data.icon} /> : n.data.kind === 'text' ? <Type /> : n.data.kind === 'video' ? <Video /> : n.data.kind === 'drawing' ? <Pencil /> : <ImagePlus />}</span>
        <span>{n.data.name || n.data.text || `Desenho ${index + 1}`}</span>
      </button>)}</div>
      {!nodes.length && <p>Adicione seu primeiro elemento na barra acima.</p>}
      <p>Shift + clique: selecionar vários.</p>
    </aside>}
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
        onPaneClick={() => { setEditing(null); setControlsHidden(hidden => !hidden); }}
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
        {!nodes.length && !presenting && <Panel position="top-center"><div className="pointer-events-none mt-16 text-center text-muted-foreground"><p className="text-xl font-semibold text-foreground">Uma tela. Todas as suas ideias.</p><p className="mt-2 text-sm">Use o botão + abaixo para adicionar textos, imagens e vídeos.</p><p className="mt-1 text-xs">Arraste arquivos para cá ou comece com um texto.</p></div></Panel>}
        {!controlsHidden && tool === 'pencil' && <Panel position={fullscreen ? 'top-center' : 'top-right'}><div className="slides-properties"><input type="color" aria-label="Cor do lápis" value={color} onChange={e => setColor(e.target.value)} /><label>Traço <input type="number" aria-label="Espessura do lápis" min={1} max={24} value={penWidth} onChange={e => setPenWidth(Math.max(1, Math.min(24, +e.target.value || 1)))} /></label></div></Panel>}
        {!controlsHidden && !presenting && <Panel position="bottom-left"><p className="slides-help">Roda do mouse: zoom · Espaço + arrastar: mover<br />Clique no fundo: esconder ou mostrar controles</p></Panel>}
        <Panel position="bottom-right"><div className="slides-tools">
          {!controlsHidden && <>
          {!presenting && <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild><button type="button" className="slides-tool" title="Adicionar conteúdo" aria-label="Adicionar conteúdo"><Plus /></button></DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" sideOffset={10} className="slides-toolbar-dropdown z-[120]" onCloseAutoFocus={e => e.preventDefault()}>
              <DropdownMenuItem onSelect={addText}><Type />Adicionar texto</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setLogoQuery(''); setLogosOpen(true); }}><Shapes />Adicionar logos</DropdownMenuItem>
              <DropdownMenuItem disabled={uploading} onSelect={() => imageInput.current?.click()}><ImagePlus />Adicionar imagens</DropdownMenuItem>
              <DropdownMenuItem disabled={uploading} onSelect={() => videoInput.current?.click()}><Video />Adicionar vídeos</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setLink(''); setLinkKind('image'); }}><Link2 />Adicionar mídia por link</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
          {!presenting && <IconButton label="Selecionar e mover objetos" active={tool === 'select'} onClick={() => setTool('select')}><MousePointer2 /></IconButton>}
          <IconButton label="Mover painel" active={tool === 'hand'} onClick={() => setTool('hand')}><Hand /></IconButton>
          <IconButton label="Lápis" active={tool === 'pencil'} onClick={() => setTool(t => t === 'pencil' ? 'hand' : 'pencil')}><Pencil /></IconButton>
          {!presenting && <IconButton label="Alinhar todos ao centro" disabled={!nodes.length} onClick={alignCollection}><AlignCenter /></IconButton>}
          <span className="slides-toolbar-divider" aria-hidden="true" />
          <IconButton label="Desfazer" disabled={!history.current.length} onClick={undo}><Undo2 /></IconButton>
          <IconButton label="Refazer" disabled={!future.current.length} onClick={redo}><Redo2 /></IconButton>
          <span className="slides-toolbar-divider" aria-hidden="true" />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild><button type="button" className="slides-tool" title="Mais opções" aria-label="Mais opções"><MoreHorizontal /></button></DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" sideOffset={10} className="slides-toolbar-dropdown z-[120]" onCloseAutoFocus={e => e.preventDefault()}>
              <DropdownMenuItem onSelect={() => void flow.zoomIn({ duration })}><Plus />Aumentar zoom</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void flow.zoomOut({ duration })}><Minus />Diminuir zoom</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void flow.fitView({ padding: .18, duration })}><Scan />Ver todo o painel</DropdownMenuItem>
              {!presenting && <><DropdownMenuSeparator />
                <DropdownMenuItem disabled={!nodes.length} onSelect={() => centerCollection('vertical')}><ArrowUpDown />Centralizar na vertical</DropdownMenuItem>
                <DropdownMenuItem disabled={!nodes.length} onSelect={() => centerCollection('horizontal')}><ArrowLeftRight />Centralizar na horizontal</DropdownMenuItem>
                <DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setTool('eraser')}><Eraser />Borracha: remover objeto</DropdownMenuItem><DropdownMenuItem onSelect={() => setHelp(true)}><HelpCircle />Como usar</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton label={presenting ? 'Sair da apresentação' : editingFullscreen ? 'Sair da edição em tela cheia' : 'Editar em tela cheia'} onClick={() => { setControlsHidden(false); setEditingFullscreen(!fullscreen); setPresenting(false); }}>{fullscreen ? <Minimize2 /> : <Maximize2 />}</IconButton>
          </>}
          <IconButton label="Editar slide" active={!presenting && !controlsHidden && tool === 'select'} onClick={() => { if (presenting) setEditingFullscreen(true); setPresenting(false); setControlsHidden(false); setTool('select'); }}><SquarePen /></IconButton>
        </div></Panel>
      </ReactFlow>

    </div>
    </div>
    <input hidden multiple ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" onChange={e => { void upload(e.target.files); e.target.value = ''; }} />
    <input hidden multiple ref={videoInput} type="file" accept="video/mp4,video/webm,video/ogg,video/quicktime" onChange={e => { void upload(e.target.files); e.target.value = ''; }} />
    <Dialog open={logosOpen} onOpenChange={setLogosOpen}><DialogContent><DialogHeader><DialogTitle>Logos de redes e aplicativos</DialogTitle></DialogHeader>
      <DialogDescription>Escolha um logo. Depois, ajuste a cor e o tamanho no slide.</DialogDescription>
      <input autoFocus aria-label="Buscar logos" placeholder="Buscar Instagram, Telegram…" className="rounded-lg border border-border bg-secondary p-3 text-sm" value={logoQuery} onChange={e => setLogoQuery(e.target.value)} />
      <div className="slides-logo-grid">{MIND_ICONS.filter(icon => icon.id !== 'none' && icon.label.toLocaleLowerCase('pt-BR').includes(logoQuery.toLocaleLowerCase('pt-BR'))).map(icon => <button key={icon.id} onClick={() => { add({ kind: 'logo', icon: icon.id, name: icon.label, color: '#f4f4f5', background: 'transparent', fontSize: 24 }, 120, 120); setLogosOpen(false); }}><BrandIcon name={icon.id} /><span>{icon.label}</span></button>)}</div>
      {!MIND_ICONS.some(icon => icon.id !== 'none' && icon.label.toLocaleLowerCase('pt-BR').includes(logoQuery.toLocaleLowerCase('pt-BR'))) && <p className="text-sm text-muted-foreground">Nenhum logo encontrado.</p>}
    </DialogContent></Dialog>
    <Dialog open={!!linkKind} onOpenChange={open => { if (!open) setLinkKind(null); }}><DialogContent><DialogHeader><DialogTitle>Adicionar mídia por link</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">Use o endereço direto de uma imagem ou vídeo. Links de páginas do YouTube e Instagram não são arquivos de vídeo.</p><select className="rounded border border-border bg-secondary p-2" aria-label="Tipo de mídia" value={linkKind || 'image'} onChange={e => setLinkKind(e.target.value as 'image' | 'video')}><option value="image">Imagem</option><option value="video">Vídeo</option></select><input aria-label="Endereço da mídia" placeholder="https://…" className="rounded border border-border bg-secondary p-2" value={link} onChange={e => setLink(e.target.value)} /><button className="rounded bg-primary p-2 text-primary-foreground" onClick={() => { const url = safeMediaUrl(link); if (!url) return toast.error('Informe um endereço http ou https válido.'); addMedia(linkKind!, url, 'Mídia por link'); setLinkKind(null); }}>Adicionar</button></DialogContent></Dialog>
    <Dialog open={help} onOpenChange={setHelp}><DialogContent><DialogHeader><DialogTitle>Seu painel livre</DialogTitle></DialogHeader><ul className="list-disc space-y-2 pl-4 text-sm"><li>Use + para adicionar textos, imagens e vídeos. O menu ⋯ reúne zoom, borracha e ajuda. Arraste os objetos e ajuste o tamanho pelos cantos.</li><li>No menu ⋯, use Centralizar na vertical ou na horizontal para mover o conjunto ao centro da tela, mantendo as distâncias e o zoom. Desfazer restaura as posições anteriores.</li><li>Use a mão para puxar o painel em qualquer direção. Também funciona segurando Espaço.</li><li>Use a roda do mouse ou o gesto de pinça para aproximar e afastar.</li><li>Dê dois cliques em um texto para editar. Na apresentação, dois cliques aproximam qualquer bloco.</li><li>Use o lápis para desenhar e a borracha para remover um objeto inteiro.</li><li>Clique no fundo para esconder os controles. Clique novamente para mostrá-los. Arrastar o painel não esconde os botões.</li><li>Desfazer e refazer também funcionam durante a apresentação.</li><li>Apresentar esconde os menus. Aperte Esc para sair.</li><li>Use Organizar para distribuir a seleção (ou todos os elementos) em linha, coluna ou grade. Ctrl+A seleciona todos e Ctrl+D duplica a seleção.</li><li>Suas mudanças são salvas automaticamente. Ctrl+Z desfaz; Ctrl+Shift+Z refaz.</li></ul></DialogContent></Dialog>
  </div>;
  void historyVersion;
  return <SlideContext.Provider value={{ mediaSize, presenting, editing, edit: setEditing, checkpoint, patch: (id, text) => setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, text } } : n)) }}><div ref={placeholder} />{createPortal(content, portalHost)}</SlideContext.Provider>;
}
// Keep one portal host stable so entering presentation never remounts the canvas or interrupts videos.

export function SlidesEditor(props: Props) { return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>; }
