import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  useReactFlow,
  ReactFlowProvider,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildMindFlow, type MindNodeData } from "./layout";
import { nodeTypes, edgeTypes } from "./MindMapNodes";
import {
  countTopics,
  createTopic,
  findParent,
  findTopic,
  mapTree,
  type MindMapData,
  type MindTopic,
} from "./types";

function cloneData(data: MindMapData): MindMapData {
  return JSON.parse(JSON.stringify(data)) as MindMapData;
}

type CanvasProps = {
  title: string;
  data: MindMapData;
  saving?: boolean;
  onBack: () => void;
  onChange: (data: MindMapData) => void;
  onSave: (data: MindMapData) => Promise<void> | void;
};

function MindMapCanvasInner({ title, data, saving, onBack, onChange, onSave }: CanvasProps) {
  const { fitView } = useReactFlow();
  const [selectedId, setSelectedId] = useState(data.root.id);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "" });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const skipFit = useRef(false);

  const flow = useMemo(() => buildMindFlow(data.root), [data]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (skipFit.current) {
        skipFit.current = false;
        return;
      }
      void fitView({ padding: 0.22, duration: 280 });
    });
    return () => cancelAnimationFrame(frame);
  }, [flow.nodes.length, data.root.expanded, fitView]);

  const selected = findTopic(data.root, selectedId) ?? data.root;

  const updateRoot = useCallback((nextRoot: MindTopic) => {
    onChange({ root: nextRoot });
  }, [onChange]);

  const toggleExpanded = (id: string) => {
    skipFit.current = false;
    updateRoot(mapTree(data.root, (node) => (node.id === id ? { ...node, expanded: !node.expanded } : node)));
  };

  const openEditor = (id: string) => {
    const topic = findTopic(data.root, id);
    if (!topic) return;
    setSelectedId(id);
    setForm({ title: topic.title, description: topic.description });
    setEditOpen(true);
  };

  const saveTopic = () => {
    if (!form.title.trim()) return toast.error("Título obrigatório");
    updateRoot(mapTree(data.root, (node) => node.id === selectedId ? { ...node, title: form.title.trim(), description: form.description.trim() } : node));
    setEditOpen(false);
  };

  const addChild = (parentId?: string) => {
    const targetId = parentId ?? selectedId;
    const next = cloneData(data);
    const parent = findTopic(next.root, targetId);
    if (!parent) return;
    const child = createTopic(`Bloco ${countTopics(next.root)}`, "");
    parent.expanded = true;
    parent.children.push(child);
    skipFit.current = false;
    onChange(next);
    setSelectedId(child.id);
    setForm({ title: child.title, description: "" });
    setEditOpen(true);
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
    onChange(next);
    setSelectedId(parent.id);
    setDeleteId(null);
    toast.success("Bloco excluído");
  };

  const onNodeClick = useCallback((_: unknown, node: Node<MindNodeData>) => {
    setSelectedId(node.id);
    const topic = findTopic(data.root, node.id);
    if (topic?.children.length) toggleExpanded(node.id);
  }, [data.root]);

  const onNodeDoubleClick = useCallback((_: unknown, node: Node<MindNodeData>) => {
    openEditor(node.id);
  }, [data.root]);

  return (
    <div className="-mx-4 -mb-4 flex h-[calc(100dvh-6.5rem)] min-h-[32rem] flex-col sm:-mx-6 sm:-mb-6 lg:-mx-8 lg:-mb-8 lg:h-[calc(100dvh-3.5rem)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background/90 px-3 py-2 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={onBack} className="flex h-10 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Voltar</span>
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground">{title}</h1>
            <p className="hidden text-[11px] text-muted-foreground sm:block">Clique para expandir · clique duplo para editar · arraste o fundo · use o zoom</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => addChild()} className="flex h-10 items-center gap-1.5 rounded-md bg-secondary px-3 text-sm text-foreground hover:bg-accent">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Bloco</span>
          </button>
          <button type="button" disabled={saving} onClick={() => void onSave(data)} className="flex h-10 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            <Save className="h-4 w-4" />
            {saving ? "Salvando" : "Salvar"}
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={flow.nodes}
          edges={flow.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          fitView
          minZoom={0.25}
          maxZoom={1.8}
          panOnDrag
          panOnScroll
          zoomOnScroll
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
          className="bg-background"
          defaultEdgeOptions={{ type: "mindEdge" }}
        >
          <Background color="hsl(0 0% 14%)" gap={24} size={1} />
          <Controls className="!bg-card !border-border !rounded-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-accent" />
          <Panel position="bottom-center" className="pointer-events-none mb-2 hidden rounded-full border border-border bg-card/80 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur md:block">
            {countTopics(data.root)} blocos · selecionado: {selected.title}
          </Panel>
        </ReactFlow>
      </div>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="border-border bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">{selectedId === data.root.id ? "Editar centro" : "Editar bloco"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Título</label>
              <input value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} className="h-10 w-full rounded-md border border-border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Descrição</label>
              <textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} className="h-24 w-full resize-none rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={saveTopic} className="h-10 flex-1 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Salvar bloco</button>
              <button type="button" onClick={() => addChild(selectedId)} className="h-10 rounded-md bg-secondary px-3 text-sm text-foreground hover:bg-accent">+ Filho</button>
              {selectedId !== data.root.id && (
                <button type="button" onClick={() => { setEditOpen(false); setDeleteId(selectedId); }} className="flex h-10 w-10 items-center justify-center rounded-md bg-destructive text-destructive-foreground" aria-label="Excluir bloco">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="border-border bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">Excluir bloco</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Esse bloco e todos os filhos dele serão removidos.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteId(null)} className="rounded-md bg-secondary px-4 py-2 text-sm text-foreground">Cancelar</button>
            <button type="button" onClick={removeTopic} className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground">Excluir</button>
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
