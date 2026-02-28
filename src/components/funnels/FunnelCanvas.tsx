import { memo, useCallback, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  Handle,
  Position,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Plus, Trash2, Save, Edit2, X,
  Instagram, Youtube, MessageCircle, Send, Globe, ShoppingCart,
  CreditCard, ArrowUpRight, ArrowDownRight, RefreshCw, Tag
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const NODE_TYPES_CONFIG = [
  { type: "instagram", label: "Instagram", icon: Instagram, color: "bg-pink-500/20 border-pink-500/50 text-pink-400" },
  { type: "youtube", label: "YouTube", icon: Youtube, color: "bg-red-500/20 border-red-500/50 text-red-400" },
  { type: "whatsapp", label: "WhatsApp", icon: MessageCircle, color: "bg-green-500/20 border-green-500/50 text-green-400" },
  { type: "telegram", label: "Telegram", icon: Send, color: "bg-blue-500/20 border-blue-500/50 text-blue-400" },
  { type: "tiktok", label: "TikTok", icon: Globe, color: "bg-purple-500/20 border-purple-500/50 text-purple-400" },
  { type: "site", label: "Site", icon: Globe, color: "bg-sky-500/20 border-sky-500/50 text-sky-400" },
  { type: "landing", label: "Pág. Vendas", icon: ShoppingCart, color: "bg-amber-500/20 border-amber-500/50 text-amber-400" },
  { type: "checkout", label: "Checkout", icon: CreditCard, color: "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" },
  { type: "front", label: "Front (F)", icon: Tag, color: "bg-indigo-500/20 border-indigo-500/50 text-indigo-400" },
  { type: "orderbump", label: "Orderbump (O)", icon: ArrowUpRight, color: "bg-orange-500/20 border-orange-500/50 text-orange-400" },
  { type: "upsell", label: "Upsell (U)", icon: ArrowUpRight, color: "bg-teal-500/20 border-teal-500/50 text-teal-400" },
  { type: "downsell", label: "Downsell (D)", icon: ArrowDownRight, color: "bg-rose-500/20 border-rose-500/50 text-rose-400" },
  { type: "remarketing", label: "Remarketing (R)", icon: RefreshCw, color: "bg-violet-500/20 border-violet-500/50 text-violet-400" },
  { type: "custom", label: "Personalizado", icon: Globe, color: "bg-secondary border-border text-foreground" },
];

const getNodeConfig = (type: string) => NODE_TYPES_CONFIG.find(n => n.type === type) || NODE_TYPES_CONFIG[NODE_TYPES_CONFIG.length - 1];

interface FunnelNodeData {
  dbId: string;
  title: string;
  description?: string;
  node_type: string;
  value?: number;
  link?: string;
  status?: string;
  [key: string]: any;
}

const FunnelNode = memo(({ data, selected }: NodeProps<Node<FunnelNodeData>>) => {
  const config = getNodeConfig(data.node_type);
  const Icon = config.icon;
  return (
    <div className={cn(
      "min-w-[160px] max-w-[220px] rounded-lg border-2 px-3 py-2 shadow-lg transition-all",
      config.color,
      selected && "ring-2 ring-ring ring-offset-1 ring-offset-background"
    )}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background" />
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 shrink-0" />
        <span className="text-xs font-semibold truncate">{data.title}</span>
      </div>
      {data.description && <p className="text-[10px] opacity-70 line-clamp-2">{data.description}</p>}
      {data.value != null && data.value > 0 && (
        <p className="text-[10px] font-medium mt-1">R$ {Number(data.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
      )}
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background" />
    </div>
  );
});
FunnelNode.displayName = "FunnelNode";

const nodeTypes = { funnelNode: FunnelNode };

interface FunnelCanvasProps {
  funnelId: string;
  onBack: () => void;
  funnelTitle: string;
}

export function FunnelCanvas({ funnelId, onBack, funnelTitle }: FunnelCanvasProps) {
  const { user } = useAuth();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FunnelNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [showAddNode, setShowAddNode] = useState(false);
  const [editNode, setEditNode] = useState<Node<FunnelNodeData> | null>(null);
  const [nodeForm, setNodeForm] = useState({ title: "", description: "", node_type: "custom", value: "", link: "", status: "active" });
  const debounceMap = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [deleteNodeId, setDeleteNodeId] = useState<string | null>(null);

  // Load data
  const loadCanvas = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [nodesRes, edgesRes] = await Promise.all([
      (supabase.from("funnel_nodes") as any).select("*").eq("funnel_id", funnelId).eq("user_id", user.id),
      (supabase.from("funnel_edges") as any).select("*").eq("funnel_id", funnelId).eq("user_id", user.id),
    ]);

    const loadedNodes: Node<FunnelNodeData>[] = (nodesRes.data || []).map((n: any) => ({
      id: n.id,
      type: "funnelNode",
      position: { x: Number(n.position_x), y: Number(n.position_y) },
      data: { dbId: n.id, title: n.title, description: n.description, node_type: n.node_type, value: n.value, link: n.link, status: n.status },
    }));

    const loadedEdges: Edge[] = (edgesRes.data || []).map((e: any) => ({
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      animated: true,
      style: { stroke: "hsl(0 0% 40%)" },
    }));

    setNodes(loadedNodes);
    setEdges(loadedEdges);
    setLoading(false);
  }, [user, funnelId, setNodes, setEdges]);

  // Load on mount
  useState(() => { loadCanvas(); });

  const onConnect = useCallback(async (connection: Connection) => {
    if (!user || !connection.source || !connection.target) return;
    const { data: edge, error } = await (supabase.from("funnel_edges") as any)
      .insert({ funnel_id: funnelId, user_id: user.id, source_node_id: connection.source, target_node_id: connection.target })
      .select().single();
    if (error) return toast.error("Erro ao criar conexão");
    setEdges(eds => addEdge({ ...connection, id: edge.id, animated: true, style: { stroke: "hsl(0 0% 40%)" } }, eds));
  }, [user, funnelId, setEdges]);

  const onNodeDragStop = useCallback((_: any, node: Node) => {
    if (!user) return;
    const existing = debounceMap.current.get(node.id);
    if (existing) clearTimeout(existing);
    debounceMap.current.set(node.id, setTimeout(async () => {
      await (supabase.from("funnel_nodes") as any)
        .update({ position_x: node.position.x, position_y: node.position.y })
        .eq("id", node.id);
      debounceMap.current.delete(node.id);
    }, 500));
  }, [user]);

  const handleAddNode = async (type: string) => {
    if (!user) return;
    const config = getNodeConfig(type);
    const { data: node, error } = await (supabase.from("funnel_nodes") as any)
      .insert({ funnel_id: funnelId, user_id: user.id, title: config.label, node_type: type, position_x: 250 + Math.random() * 200, position_y: 150 + Math.random() * 200 })
      .select().single();
    if (error) return toast.error("Erro ao criar nó");
    setNodes(nds => [...nds, {
      id: node.id, type: "funnelNode",
      position: { x: Number(node.position_x), y: Number(node.position_y) },
      data: { dbId: node.id, title: node.title, description: node.description, node_type: node.node_type, value: node.value, link: node.link, status: node.status },
    }]);
    setShowAddNode(false);
    toast.success("Nó adicionado!");
  };

  const openEditNode = (node: Node<FunnelNodeData>) => {
    setEditNode(node);
    setNodeForm({
      title: node.data.title,
      description: node.data.description || "",
      node_type: node.data.node_type,
      value: node.data.value ? String(node.data.value) : "",
      link: node.data.link || "",
      status: node.data.status || "active",
    });
  };

  const handleSaveNode = async () => {
    if (!editNode || !nodeForm.title.trim()) return toast.error("Título obrigatório");
    const payload = {
      title: nodeForm.title,
      description: nodeForm.description || null,
      node_type: nodeForm.node_type,
      value: nodeForm.value ? Number(nodeForm.value) : null,
      link: nodeForm.link || null,
      status: nodeForm.status,
    };
    const { error } = await (supabase.from("funnel_nodes") as any).update(payload).eq("id", editNode.id);
    if (error) return toast.error("Erro ao salvar");
    setNodes(nds => nds.map(n => n.id === editNode.id ? { ...n, data: { ...n.data, ...payload } } : n));
    setEditNode(null);
    toast.success("Nó atualizado!");
  };

  const handleDeleteNode = async () => {
    if (!deleteNodeId) return;
    // Delete edges first
    await (supabase.from("funnel_edges") as any).delete().or(`source_node_id.eq.${deleteNodeId},target_node_id.eq.${deleteNodeId}`);
    await (supabase.from("funnel_nodes") as any).delete().eq("id", deleteNodeId);
    setNodes(nds => nds.filter(n => n.id !== deleteNodeId));
    setEdges(eds => eds.filter(e => e.source !== deleteNodeId && e.target !== deleteNodeId));
    setDeleteNodeId(null);
    toast.success("Nó excluído!");
  };

  const handleDeleteEdge = async (edgeId: string) => {
    await (supabase.from("funnel_edges") as any).delete().eq("id", edgeId);
    setEdges(eds => eds.filter(e => e.id !== edgeId));
  };

  const onNodeDoubleClick = useCallback((_: any, node: Node<FunnelNodeData>) => {
    openEditNode(node);
  }, []);

  const onEdgeDoubleClick = useCallback((_: any, edge: Edge) => {
    handleDeleteEdge(edge.id);
  }, []);

  const handleExportJSON = () => {
    const data = { nodes: nodes.map(n => ({ ...n.data, position: n.position })), edges: edges.map(e => ({ source: e.source, target: e.target })) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `funil-${funnelTitle}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("JSON exportado!");
  };

  if (loading) {
    return <div className="flex items-center justify-center h-[calc(100vh-8rem)]"><div className="animate-pulse text-muted-foreground">Carregando canvas...</div></div>;
  }

  return (
    <div className="h-[calc(100vh-8rem)] w-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        className="bg-background"
        defaultEdgeOptions={{ animated: true, style: { stroke: "hsl(0 0% 40%)" } }}
      >
        <Background color="hsl(0 0% 15%)" gap={20} />
        <Controls className="!bg-card !border-border !rounded-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-accent" />
        <MiniMap
          nodeStrokeColor="hsl(0 0% 40%)"
          nodeColor="hsl(0 0% 15%)"
          maskColor="hsl(0 0% 4% / 0.8)"
          className="!bg-card !border-border !rounded-lg"
        />
        <Panel position="top-left" className="flex items-center gap-2">
          <button onClick={onBack} className="px-3 py-1.5 rounded-md bg-secondary text-sm text-foreground hover:bg-accent transition-colors">
            ← Voltar
          </button>
          <h2 className="text-sm font-semibold text-foreground bg-card/80 px-3 py-1.5 rounded-md border border-border">{funnelTitle}</h2>
        </Panel>
        <Panel position="top-right" className="flex items-center gap-2">
          <button onClick={() => setShowAddNode(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
            <Plus className="w-3.5 h-3.5" /> Nó
          </button>
          <button onClick={handleExportJSON} className="px-3 py-1.5 rounded-md bg-secondary text-sm text-foreground hover:bg-accent transition-colors">
            JSON
          </button>
        </Panel>
      </ReactFlow>

      {/* Add Node Dialog */}
      <Dialog open={showAddNode} onOpenChange={setShowAddNode}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader><DialogTitle className="text-foreground">Adicionar Nó</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto">
            {NODE_TYPES_CONFIG.map(nt => {
              const Icon = nt.icon;
              return (
                <button key={nt.type} onClick={() => handleAddNode(nt.type)}
                  className={cn("flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-all hover:scale-[1.02]", nt.color)}>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-xs font-medium">{nt.label}</span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Node Dialog */}
      <Dialog open={!!editNode} onOpenChange={() => setEditNode(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Editar Nó</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Título</label>
              <input type="text" value={nodeForm.title} onChange={e => setNodeForm({ ...nodeForm, title: e.target.value })}
                className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Descrição</label>
              <textarea value={nodeForm.description} onChange={e => setNodeForm({ ...nodeForm, description: e.target.value })}
                className="w-full h-20 px-3 py-2 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Tipo</label>
                <select value={nodeForm.node_type} onChange={e => setNodeForm({ ...nodeForm, node_type: e.target.value })}
                  className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
                  {NODE_TYPES_CONFIG.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Status</label>
                <select value={nodeForm.status} onChange={e => setNodeForm({ ...nodeForm, status: e.target.value })}
                  className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none">
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                  <option value="draft">Rascunho</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Preço/Valor</label>
                <input type="number" value={nodeForm.value} onChange={e => setNodeForm({ ...nodeForm, value: e.target.value })} placeholder="0.00" step="0.01"
                  className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Link</label>
                <input type="url" value={nodeForm.link} onChange={e => setNodeForm({ ...nodeForm, link: e.target.value })} placeholder="https://..."
                  className="w-full h-10 px-3 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveNode} className="flex-1 h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
                <Save className="w-4 h-4 inline mr-2" />Salvar
              </button>
              <button onClick={() => { setEditNode(null); setDeleteNodeId(editNode?.id || null); }}
                className="h-10 px-4 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Node Confirmation */}
      <Dialog open={!!deleteNodeId} onOpenChange={() => setDeleteNodeId(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">Excluir Nó</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Tem certeza? As conexões deste nó também serão removidas.</p>
          <div className="flex gap-2 justify-end mt-4">
            <button onClick={() => setDeleteNodeId(null)} className="px-4 py-2 rounded-md bg-secondary text-sm text-foreground">Cancelar</button>
            <button onClick={handleDeleteNode} className="px-4 py-2 rounded-md bg-destructive text-destructive-foreground text-sm font-medium">Excluir</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
