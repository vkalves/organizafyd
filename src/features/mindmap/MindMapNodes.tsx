import { memo } from "react";
import {
  Handle,
  Position,
  BaseEdge,
  getBezierPath,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MindNodeData } from "./layout";

const MindRootNode = memo(({ data, selected }: NodeProps<Node<MindNodeData>>) => {
  return (
    <div
      className={cn(
        "mindmap-root relative w-[280px] rounded-xl border bg-card px-5 py-5 text-center shadow-xl",
        selected ? "border-foreground/50" : "border-border",
      )}
      style={{ boxShadow: "0 0 48px hsla(0, 0%, 100%, 0.06)" }}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0 !pointer-events-none" />
      <Handle type="source" position={Position.Left} id="left" className="!opacity-0 !pointer-events-none" />
      <Handle type="source" position={Position.Right} id="right" className="!opacity-0 !pointer-events-none" />
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Mapa mental</p>
      <h2 className="mt-2 text-lg font-semibold leading-tight text-foreground">{data.title || "Sem título"}</h2>
      {data.description ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{data.description}</p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground/70">Clique para editar o centro</p>
      )}
      {data.hasChildren && (
        <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-1 text-[10px] text-muted-foreground">
          {data.expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {data.expanded ? "Recolher" : "Expandir"}
        </div>
      )}
    </div>
  );
});
MindRootNode.displayName = "MindRootNode";

const MindBranchNode = memo(({ data, selected }: NodeProps<Node<MindNodeData>>) => {
  return (
    <div
      className={cn(
        "relative w-[240px] rounded-xl border bg-card/95 px-4 py-3 shadow-lg backdrop-blur-sm transition-colors",
        selected ? "border-foreground/40 bg-card" : "border-border hover:border-foreground/25",
      )}
    >
      <Handle id="in-left" type="target" position={Position.Left} className="!opacity-0 !pointer-events-none" />
      <Handle id="in-right" type="target" position={Position.Right} className="!opacity-0 !pointer-events-none" />
      <Handle id="left" type="source" position={Position.Left} className="!opacity-0 !pointer-events-none" />
      <Handle id="right" type="source" position={Position.Right} className="!opacity-0 !pointer-events-none" />
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-snug text-foreground">{data.title || "Sem título"}</h3>
        {data.hasChildren && (
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground">
            {data.expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </span>
        )}
      </div>
      {data.description ? (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{data.description}</p>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground/60">Clique para expandir ou editar</p>
      )}
    </div>
  );
});
MindBranchNode.displayName = "MindBranchNode";

function MindEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.45,
  });

  return (
    <>
      <BaseEdge id={`${id}-glow`} path={edgePath} style={{ stroke: "hsla(0, 0%, 100%, 0.12)", strokeWidth: 8 }} />
      <BaseEdge id={id} path={edgePath} style={{ stroke: "hsla(0, 0%, 100%, 0.42)", strokeWidth: 1.6 }} />
    </>
  );
}

export const nodeTypes = { mindRoot: MindRootNode, mindBranch: MindBranchNode };
export const edgeTypes = { mindEdge: MindEdge };
