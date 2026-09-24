import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  ReactFlowProvider,
  useNodesState,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Focus,
  Maximize2,
  Minimize2,
  Move,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BrandIcon, MIND_ICONS, type MindIconName } from "./BrandIcons";
import { buildMindFlow, type MindNodeData } from "./layout";
import { nodeTypes, edgeTypes } from "./MindMapNodes";
import {
  cloneTopicWithNewIds,
  countTopics,
  createTopic,
  findParent,
  findTopic,
  mapTree,
  type MindMapData,
  type MindTopic,
  type MindTopicColor,
} from "./types";

function cloneData(data: MindMapData): MindMapData {
  return JSON.parse(JSON.stringify(data)) as MindMapData;
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(https?:\/\/|mailto:|tel:)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

const COLOR_OPTIONS: { id: MindTopicColor; label: string; dot: string; selected: string }[] = [
  { id: "neutral", label: "Neutro", dot: "bg-zinc-400", selected: "border-zinc-400/60 bg-zinc-400/10" },
  { id: "blue", label: "Azul", dot: "bg-blue-400", selected: "border-blue-400/60 bg-blue-400/10" },
  { id: "violet", label: "Violeta", dot: "bg-violet-400", selected: "border-violet-400/60 bg-violet-400/10" },
  { id: "pink", label: "Rosa", dot: "bg-pink-400", selected: "border-pink-400/60 bg-pink-400/10" },
  { id: "green", label: "Verde", dot: "bg-emerald-400", selected: "border-emerald-400/60 bg-emerald-400/10" },
  { id: "orange", label: "Laranja", dot: "bg-orange-400", selected: "border-orange-400/60 bg-orange-400/10" },
  { id: "red", label: "Vermelho", dot: "bg-red-400", selected: "border-red-400/60 bg-red-400/10" },
];

type TopicForm = {
  title: string;
  description: string;
  url: string;
  icon: MindIconName;
  color: MindTopicColor;
};

type CanvasProps = {
  title: string;
  data: MindMapData;
  saving?: boolean;
  onBack: () => void;
  onChange: (data: MindMapData) => void;
  onSave: (data: MindMapData) => Promise<void> | void;
};

function ToolbarButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={
        danger
          ? "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-35"
          : "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-35"
      }
    >
      {children}
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}

function MindMapCanvasInner({ title, data, saving, onBack, onChange, onSave }: CanvasProps) {
  const { fitView } = useReactFlow();
  const [selectedId, setSelectedId] = useState(data.root.id);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<TopicForm>({
    title: "",
    description: "",
    url: "",
    icon: "none",
    color: "neutral",
  });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [history, setHistory] = useState<MindMapData[]>([]);
  const [future, setFuture] = useState<MindMapData[]>([]);
  const [dirty, setDirty] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const skipFit = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const flow = useMemo(() => buildMindFlow(data.root), [data]);
  const [nodes, setNodes, onNodesChange] = useNodesState(flow.nodes);

  useEffect(() => {
    setNodes(flow.nodes);
  }, [flow.nodes, setNodes]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (skipFit.current) {
        skipFit.current = false;
        return;
      }
      void fitView({ padding: 0.2, duration: 280, maxZoom: 1.05 });
    });
    return () => cancelAnimationFrame(frame);
  }, [flow.nodes.length, data.root.expanded, fitView]);

  const selected = findTopic(data.root, selectedId) ?? data.root;

  const applyData = useCallback((next: MindMapData, options?: { fit?: boolean }) => {
    setHistory((prev) => [...prev.slice(-39), cloneData(data)]);
    setFuture([]);
    skipFit.current = options?.fit === false;
    onChange(next);
    setDirty(true);
  }, [data, onChange]);

  const updateRoot = useCallback((nextRoot: MindTopic, options?: { fit?: boolean }) => {
    applyData({ root: nextRoot }, options);
  }, [applyData]);

  const toggleExpanded = useCallback((id: string) => {
    const topic = findTopic(data.root, id);
    if (!topic?.children.length) return;
    updateRoot(
      mapTree(data.root, (node) => (node.id === id ? { ...node, expanded: !node.expanded } : node)),
      { fit: false },
    );
  }, [data.root, updateRoot]);

  const openEditor = useCallback((id: string) => {
    const topic = findTopic(data.root, id);
    if (!topic) return;
    setSelectedId(id);
    setForm({
      title: topic.title,
      description: topic.description,
      url: topic.url ?? "",
      icon: topic.icon ?? "none",
      color: topic.color ?? "neutral",
    });
    setEditOpen(true);
  }, [data.root]);

  const saveTopic = () => {
    if (!form.title.trim()) return toast.error("Título obrigatório");
    updateRoot(
      mapTree(data.root, (node) =>
        node.id === selectedId
          ? {
              ...node,
              title: form.title.trim(),
              description: form.description.trim(),
              url: normalizeUrl(form.url),
              icon: form.icon === "none" ? null : form.icon,
              color: form.color,
            }
          : node,
      ),
      { fit: false },
    );
    setEditOpen(false);
  };

  const addChild = (parentId?: string) => {
    const targetId = parentId ?? selectedId;
    const next = cloneData(data);
    const parent = findTopic(next.root, targetId);
    if (!parent) return;

    const child = createTopic(`Bloco ${countTopics(next.root) + 1}`, "");
    child.color = parent.color ?? "neutral";
    parent.expanded = true;
    parent.children.push(child);

    applyData(next);
    setSelectedId(child.id);
    setForm({
      title: child.title,
      description: "",
      url: "",
      icon: "none",
      color: child.color,
    });
    setEditOpen(true);
  };

  const duplicateTopic = (id = selectedId) => {
    if (id === data.root.id) return;
    const next = cloneData(data);
    const parent = findParent(next.root, id);
    const original = findTopic(next.root, id);
    if (!parent || !original) return;

    const duplicate = cloneTopicWithNewIds(original);
    duplicate.title = `${original.title} (cópia)`;
    const index = parent.children.findIndex((child) => child.id === id);
    parent.children.splice(index + 1, 0, duplicate);

    applyData(next);
    setSelectedId(duplicate.id);
    toast.success("Bloco duplicado");
  };

  const removeTopic = () => {
    if (!deleteId || deleteId === data.root.id) {
      setDeleteId(null);
      return;
    }
    const next = cloneData(data);
    const parent = findParent(next.root, deleteId);
    if (!parent) return;

    parent.children = parent.children.filter((child) => child.id !== deleteId);
    applyData(next);
    setSelectedId(parent.id);
    setDeleteId(null);
    toast.success("Bloco excluído");
  };

  const undo = useCallback(() => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((prev) => prev.slice(0, -1));
    setFuture((prev) => [cloneData(data), ...prev].slice(0, 40));
    skipFit.current = true;
    onChange(cloneData(previous));
    setDirty(true);
  }, [data, history, onChange]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    setFuture((prev) => prev.slice(1));
    setHistory((prev) => [...prev.slice(-39), cloneData(data)]);
    skipFit.current = true;
    onChange(cloneData(next));
    setDirty(true);
  }, [data, future, onChange]);

  const saveMap = async () => {
    try {
      await onSave(data);
      setDirty(false);
    } catch {
      toast.error("Não foi possível salvar o mapa");
    }
  };

  const openSelectedLink = () => {
    if (!selected.url) return;
    window.open(normalizeUrl(selected.url), "_blank", "noopener,noreferrer");
  };

  const centerMap = () => {
    void fitView({ padding: 0.2, duration: 300, maxZoom: 1.05 });
  };

  const persistLayoutChange = useCallback(async (next: MindMapData, successMessage?: string) => {
    applyData(next, { fit: false });
    try {
      await onSave(next);
      setDirty(false);
      if (successMessage) toast.success(successMessage);
    } catch {
      toast.error("Não foi possível salvar a posição dos blocos");
    }
  }, [applyData, onSave]);

  const onNodeDragStop = useCallback((_: unknown, node: Node<MindNodeData>) => {
    const next = cloneData(data);
    const topic = findTopic(next.root, node.id);
    if (!topic) return;

    topic.position = {
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
    };

    void persistLayoutChange(next);
  }, [data, persistLayoutChange]);

  const resetLayout = useCallback(() => {
    const next: MindMapData = {
      root: mapTree(data.root, (node) => ({ ...node, position: undefined })),
    };

    applyData(next);
    void onSave(next)
      .then(() => {
        setDirty(false);
        toast.success("Blocos reorganizados");
      })
      .catch(() => toast.error("Não foi possível reorganizar o mapa"));
  }, [applyData, data.root, onSave]);

  const toggleFullscreen = () => {
    setIsFullscreen((current) => !current);
  };

  useEffect(() => {
    if (!isFullscreen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };

    window.addEventListener("keydown", handleEscape);
    requestAnimationFrame(() => {
      void fitView({ padding: 0.2, duration: 220, maxZoom: 1.05 });
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
      requestAnimationFrame(() => {
        void fitView({ padding: 0.2, duration: 220, maxZoom: 1.05 });
      });
    };
  }, [isFullscreen, fitView]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (isTyping || editOpen || deleteId) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteId, editOpen, redo, undo]);

  const onNodeClick = useCallback((event: ReactMouseEvent, node: Node<MindNodeData>) => {
    const target = event.target as HTMLElement | null;
    setSelectedId(node.id);
    if (target?.closest("[data-mind-expand]")) {
      toggleExpanded(node.id);
    }
  }, [toggleExpanded]);

  const onNodeDoubleClick = useCallback((_: ReactMouseEvent, node: Node<MindNodeData>) => {
    openEditor(node.id);
  }, [openEditor]);

  return (
    <div
      ref={canvasRef}
      className={
        isFullscreen
          ? "fixed inset-0 z-[100] flex h-[100dvh] w-screen flex-col bg-background"
          : "-mx-4 -mb-4 flex h-[calc(100dvh-6.5rem)] min-h-[34rem] flex-col sm:-mx-6 sm:-mb-6 lg:-mx-8 lg:-mb-8 lg:h-[calc(100dvh-3.5rem)]"
      }
    >
      <div className="shrink-0 border-b border-border bg-background/95 backdrop-blur-xl">
        <div className="flex min-h-14 items-center justify-between gap-2 px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Voltar</span>
            </button>
            <div className="h-5 w-px bg-border" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-semibold text-foreground">{title}</h1>
                <span
                  className={
                    dirty
                      ? "hidden rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] text-orange-300 sm:inline"
                      : "hidden rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 sm:inline"
                  }
                >
                  {dirty ? "Não salvo" : "Salvo"}
                </span>
              </div>
              <p className="hidden text-[10px] text-muted-foreground md:block">
                Arraste os blocos para mover · clique duplo para editar · Ctrl+Z para desfazer
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Desfazer"
              disabled={!history.length}
              onClick={undo}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Refazer"
              disabled={!future.length}
              onClick={redo}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Enquadrar mapa"
              onClick={centerMap}
              className="hidden h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground sm:flex"
            >
              <Focus className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Reorganizar blocos"
              aria-label="Reorganizar blocos automaticamente"
              onClick={resetLayout}
              className="hidden h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground sm:flex"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
              aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
              onClick={toggleFullscreen}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveMap()}
              className="ml-1 flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span className="hidden sm:inline">{saving ? "Salvando" : "Salvar"}</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto border-t border-border/60 px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-4">
          <div className="mr-2 flex min-w-0 items-center gap-2 rounded-md bg-secondary/55 px-2.5 py-1.5">
            {selected.icon && selected.icon !== "none" ? (
              <BrandIcon name={selected.icon} className="h-3.5 w-3.5 shrink-0 text-foreground" />
            ) : null}
            <span className="max-w-[130px] truncate text-xs font-medium text-foreground sm:max-w-[220px]">{selected.title}</span>
          </div>

          <ToolbarButton label="Sub-bloco" onClick={() => addChild()}>
            <Plus className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Editar" onClick={() => openEditor(selectedId)}>
            <Pencil className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Duplicar" disabled={selectedId === data.root.id} onClick={() => duplicateTopic()}>
            <Copy className="h-3.5 w-3.5" />
          </ToolbarButton>
          {selected.children.length > 0 && (
            <ToolbarButton label={selected.expanded ? "Recolher" : "Expandir"} onClick={() => toggleExpanded(selectedId)}>
              {selected.expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </ToolbarButton>
          )}
          {selected.url && (
            <ToolbarButton label="Abrir link" onClick={openSelectedLink}>
              <ExternalLink className="h-3.5 w-3.5" />
            </ToolbarButton>
          )}
          {selectedId !== data.root.id && (
            <ToolbarButton label="Excluir" danger onClick={() => setDeleteId(selectedId)}>
              <Trash2 className="h-3.5 w-3.5" />
            </ToolbarButton>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={flow.edges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeDragStop={onNodeDragStop}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1.05 }}
          minZoom={0.18}
          maxZoom={2}
          panOnDrag
          panOnScroll
          zoomOnScroll
          zoomOnDoubleClick={false}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
          className="bg-background"
          defaultEdgeOptions={{ type: "mindEdge" }}
        >
          <Background color="hsl(0 0% 15%)" gap={26} size={1} />
          <Controls className="!rounded-lg !border-border !bg-card/95 [&>button]:!border-border [&>button]:!bg-card [&>button]:!text-foreground [&>button:hover]:!bg-accent" />
          <MiniMap
            pannable
            zoomable
            className="!hidden !rounded-xl !border !border-border !bg-card/90 md:!block"
            nodeColor="hsl(0 0% 32%)"
            maskColor="hsla(0, 0%, 0%, 0.58)"
          />
          <Panel
            position="bottom-center"
            className="pointer-events-none mb-2 hidden rounded-full border border-border bg-card/80 px-3 py-1 text-[10px] text-muted-foreground backdrop-blur lg:block"
          >
            <span className="inline-flex items-center gap-1.5">
              <Move className="h-3 w-3" />
              {countTopics(data.root)} blocos · arraste um bloco para mover · arraste o fundo para navegar
            </span>
          </Panel>
        </ReactFlow>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto border-border bg-card sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">{selectedId === data.root.id ? "Editar centro" : "Editar bloco"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Título</label>
                <input
                  autoFocus
                  value={form.title}
                  onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      saveTopic();
                    }
                  }}
                  className="h-10 w-full rounded-md border border-border bg-secondary px-3 text-sm text-foreground outline-none focus:border-foreground/30 focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Descrição</label>
                <textarea
                  value={form.description}
                  onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Contexto, observação ou próxima ação..."
                  className="h-20 w-full resize-none rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/30"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Link do bloco</label>
                <input
                  value={form.url}
                  onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
                  placeholder="instagram.com/perfil, t.me/... ou qualquer URL"
                  className="h-10 w-full rounded-md border border-border bg-secondary px-3 text-sm text-foreground outline-none focus:border-foreground/30"
                />
                <p className="mt-1 text-[10px] text-muted-foreground/70">Depois de salvar, o link pode ser aberto direto pela barra de ações.</p>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Ícone SVG</label>
                <span className="text-[10px] text-muted-foreground/70">Redes sociais e sites</span>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {MIND_ICONS.map((icon) => {
                  const active = form.icon === icon.id;
                  return (
                    <button
                      key={icon.id}
                      type="button"
                      title={icon.label}
                      aria-label={icon.label}
                      onClick={() => setForm((prev) => ({ ...prev, icon: icon.id }))}
                      className={
                        active
                          ? "flex h-12 flex-col items-center justify-center gap-1 rounded-lg border border-foreground/45 bg-accent text-foreground"
                          : "flex h-12 flex-col items-center justify-center gap-1 rounded-lg border border-border bg-secondary/40 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      }
                    >
                      {icon.id === "none" ? (
                        <span className="text-[15px] leading-none">—</span>
                      ) : (
                        <BrandIcon name={icon.id} className="h-4 w-4" />
                      )}
                      <span className="max-w-full truncate px-1 text-[8px]">{icon.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium text-muted-foreground">Cor do bloco</label>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {COLOR_OPTIONS.map((option) => {
                  const active = form.color === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, color: option.id }))}
                      className={
                        active
                          ? `flex h-10 items-center justify-center gap-1.5 rounded-md border px-2 text-[10px] text-foreground ${option.selected}`
                          : "flex h-10 items-center justify-center gap-1.5 rounded-md border border-border bg-secondary/30 px-2 text-[10px] text-muted-foreground hover:bg-accent"
                      }
                    >
                      <span className={`h-2.5 w-2.5 rounded-full ${option.dot}`} />
                      <span className="hidden sm:inline">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={saveTopic}
                className="h-10 min-w-[130px] flex-1 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Salvar bloco
              </button>
              <button
                type="button"
                onClick={() => addChild(selectedId)}
                className="flex h-10 items-center gap-1.5 rounded-md bg-secondary px-3 text-sm text-foreground hover:bg-accent"
              >
                <Plus className="h-4 w-4" /> Filho
              </button>
              {selectedId !== data.root.id && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setEditOpen(false);
                      duplicateTopic(selectedId);
                    }}
                    className="flex h-10 items-center gap-1.5 rounded-md bg-secondary px-3 text-sm text-foreground hover:bg-accent"
                  >
                    <Copy className="h-4 w-4" /> Duplicar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditOpen(false);
                      setDeleteId(selectedId);
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-md bg-destructive text-destructive-foreground"
                    aria-label="Excluir bloco"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent className="border-border bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">Excluir bloco</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Esse bloco e todos os filhos dele serão removidos do mapa.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteId(null)} className="rounded-md bg-secondary px-4 py-2 text-sm text-foreground">
              Cancelar
            </button>
            <button type="button" onClick={removeTopic} className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground">
              Excluir
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function MindMapCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <MindMapCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
