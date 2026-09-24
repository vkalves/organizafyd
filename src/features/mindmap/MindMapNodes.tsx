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
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandIcon } from "./BrandIcons";
import type { MindNodeData } from "./layout";
import type { MindTopicColor } from "./types";

const tone: Record<MindTopicColor, { line: string; icon: string; selected: string }> = {
  neutral: {
    line: "bg-foreground/35",
    icon: "border-border bg-secondary text-foreground",
    selected: "border-foreground/45",
  },
  blue: {
    line: "bg-blue-400",
    icon: "border-blue-400/25 bg-blue-500/10 text-blue-300",
    selected: "border-blue-400/55",
  },
  violet: {
    line: "bg-violet-400",
    icon: "border-violet-400/25 bg-violet-500/10 text-violet-300",
    selected: "border-violet-400/55",
  },
  pink: {
    line: "bg-pink-400",
    icon: "border-pink-400/25 bg-pink-500/10 text-pink-300",
    selected: "border-pink-400/55",
  },
  green: {
    line: "bg-emerald-400",
    icon: "border-emerald-400/25 bg-emerald-500/10 text-emerald-300",
    selected: "border-emerald-400/55",
  },
  orange: {
    line: "bg-orange-400",
    icon: "border-orange-400/25 bg-orange-500/10 text-orange-300",
    selected: "border-orange-400/55",
  },
  red: {
    line: "bg-red-400",
    icon: "border-red-400/25 bg-red-500/10 text-red-300",
    selected: "border-red-400/55",
  },
};

function NodeIcon({ data, large = false }: { data: MindNodeData; large?: boolean }) {
  if (!data.icon || data.icon === "none") return null;
  const color = tone[data.color ?? "neutral"];
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg border",
        color.icon,
        large ? "h-10 w-10" : "h-8 w-8",
      )}
    >
      <BrandIcon name={data.icon} className={large ? "h-5 w-5" : "h-4 w-4"} />
    </div>
  );
}

const MindRootNode = memo(({ data, selected }: NodeProps<Node<MindNodeData>>) => {
  const color = tone[data.color ?? "neutral"];

  return (
    <div
      className={cn(
        "mindmap-root relative w-[300px] overflow-hidden rounded-2xl border bg-card/95 px-5 py-5 text-center shadow-2xl backdrop-blur",
        selected ? color.selected : "border-border",
      )}
      style={{ boxShadow: "0 18px 64px hsla(0, 0%, 0%, 0.34), 0 0 52px hsla(0, 0%, 100%, 0.035)" }}
    >
      <div className={cn("absolute inset-x-8 top-0 h-px", color.line)} />
      <Handle type="target" position={Position.Left} className="!pointer-events-none !opacity-0" />
      <Handle type="source" position={Position.Left} id="left" className="!pointer-events-none !opacity-0" />
      <Handle type="source" position={Position.Right} id="right" className="!pointer-events-none !opacity-0" />

      <div className="flex flex-col items-center">
        <NodeIcon data={data} large />
        <p className={cn("text-[10px] uppercase tracking-[0.22em] text-muted-foreground", data.icon && data.icon !== "none" ? "mt-3" : "")}>
          Mapa mental
        </p>
        <h2 className="mt-2 max-w-[250px] text-lg font-semibold leading-tight text-foreground">
          {data.title || "Sem título"}
        </h2>
        {data.description ? (
          <p className="mt-2 line-clamp-3 max-w-[250px] text-xs leading-relaxed text-muted-foreground">{data.description}</p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground/60">Clique duplo para editar o centro</p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
          {data.hasChildren && (
            <button type="button" data-mind-expand className="nodrag nopan inline-flex items-center gap-1 rounded-full border border-border bg-secondary/70 px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              {data.expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {data.childCount} {data.childCount === 1 ? "ramo" : "ramos"}
            </button>
          )}
          {data.url && (
            <div className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/70 px-2.5 py-1 text-[10px] text-muted-foreground">
              <ExternalLink className="h-3 w-3" />
              Link
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
MindRootNode.displayName = "MindRootNode";

const MindBranchNode = memo(({ data, selected }: NodeProps<Node<MindNodeData>>) => {
  const color = tone[data.color ?? "neutral"];

  return (
    <div
      className={cn(
        "relative w-[252px] overflow-hidden rounded-xl border bg-card/95 px-4 py-3.5 shadow-xl backdrop-blur-sm transition-all duration-150",
        selected ? cn(color.selected, "translate-y-[-1px]") : "border-border hover:border-foreground/20",
      )}
    >
      <div className={cn("absolute bottom-3 left-0 top-3 w-0.5 rounded-r-full", color.line)} />
      <Handle id="in-left" type="target" position={Position.Left} className="!pointer-events-none !opacity-0" />
      <Handle id="in-right" type="target" position={Position.Right} className="!pointer-events-none !opacity-0" />
      <Handle id="left" type="source" position={Position.Left} className="!pointer-events-none !opacity-0" />
      <Handle id="right" type="source" position={Position.Right} className="!pointer-events-none !opacity-0" />

      <div className="flex items-start gap-3">
        <NodeIcon data={data} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{data.title || "Sem título"}</h3>
            {data.hasChildren && (
              <button type="button" data-mind-expand className="nodrag nopan mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-0.5 rounded-full border border-border bg-secondary px-1 text-[9px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                {data.expanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                {data.childCount}
              </button>
            )}
          </div>
          {data.description ? (
            <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{data.description}</p>
          ) : (
            <p className="mt-1.5 text-[11px] text-muted-foreground/55">Clique duplo para editar</p>
          )}
          {data.url && (
            <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground/80">
              <ExternalLink className="h-3 w-3" />
              Possui link
            </div>
          )}
        </div>
      </div>
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
    curvature: 0.48,
  });

  return (
    <>
      <BaseEdge id={`${id}-glow`} path={edgePath} style={{ stroke: "hsla(0, 0%, 100%, 0.08)", strokeWidth: 9 }} />
      <BaseEdge id={id} path={edgePath} style={{ stroke: "hsla(0, 0%, 100%, 0.32)", strokeWidth: 1.5 }} />
    </>
  );
}

export const nodeTypes = { mindRoot: MindRootNode, mindBranch: MindBranchNode };
export const edgeTypes = { mindEdge: MindEdge };
