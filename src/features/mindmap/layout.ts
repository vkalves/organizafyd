import { Position, type Edge, type Node } from "@xyflow/react";
import type { MindIconName } from "./BrandIcons";
import type { MindMapLayout, MindTopic, MindTopicColor } from "./types";

export const ROOT_WIDTH = 300;
export const BRANCH_WIDTH = 252;
export const BRANCH_HEIGHT = 104;

const LEVEL_GAP_X = 370;
const SIBLING_GAP_Y = 34;
const VERTICAL_LEVEL_GAP = 145;
const VERTICAL_SIBLING_GAP = 44;
const ORG_LEVEL_GAP = 105;
const ORG_SIBLING_GAP = 24;

export type MindNodeData = {
  title: string;
  description: string;
  isRoot: boolean;
  expanded: boolean;
  hasChildren: boolean;
  childCount: number;
  icon?: MindIconName | null;
  color?: MindTopicColor;
  url?: string;
};

type Side = "center" | "left" | "right" | "down";

type Placed = {
  id: string;
  topic: MindTopic;
  depth: number;
  side: Side;
  x: number;
  y: number;
  height: number;
};

type Link = {
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
};

function nodeWidth(item: Placed) {
  return item.side === "center" ? ROOT_WIDTH : BRANCH_WIDTH;
}

function subtreeHeight(topic: MindTopic): number {
  if (!topic.expanded || topic.children.length === 0) return BRANCH_HEIGHT;
  const children = topic.children.reduce(
    (sum, child) => sum + subtreeHeight(child) + SIBLING_GAP_Y,
    -SIBLING_GAP_Y,
  );
  return Math.max(BRANCH_HEIGHT, children);
}

function subtreeWidth(topic: MindTopic, gap: number): number {
  if (!topic.expanded || topic.children.length === 0) return BRANCH_WIDTH;
  const children = topic.children.reduce(
    (sum, child) => sum + subtreeWidth(child, gap) + gap,
    -gap,
  );
  return Math.max(BRANCH_WIDTH, children);
}

function placeRadialChildren(
  parent: Placed,
  topics: MindTopic[],
  depth: number,
  placed: Placed[],
  edges: Link[],
) {
  if (!parent.topic.expanded || topics.length === 0) return;

  const mid = Math.ceil(topics.length / 2);
  const left = topics.slice(0, mid);
  const right = topics.slice(mid);

  const layoutSide = (items: MindTopic[], side: "left" | "right") => {
    const dir = side === "left" ? -1 : 1;
    const total = items.reduce(
      (sum, item) => sum + subtreeHeight(item) + SIBLING_GAP_Y,
      -SIBLING_GAP_Y,
    );
    let cursor = parent.y + parent.height / 2 - total / 2;

    items.forEach((topic) => {
      const height = subtreeHeight(topic);
      const autoX = parent.x + dir * LEVEL_GAP_X;
      const autoY = cursor + (height - BRANCH_HEIGHT) / 2;
      const node: Placed = {
        id: topic.id,
        topic,
        depth,
        side,
        x: topic.position?.x ?? autoX,
        y: topic.position?.y ?? autoY,
        height: BRANCH_HEIGHT,
      };

      placed.push(node);
      edges.push({
        source: parent.id,
        target: topic.id,
        sourceHandle: parent.side === "center" ? side : parent.side,
        targetHandle: side === "left" ? "in-right" : "in-left",
      });

      placeRadialChildren(node, topic.children, depth + 1, placed, edges);
      cursor += height + SIBLING_GAP_Y;
    });
  };

  if (parent.side === "center") {
    layoutSide(left, "left");
    layoutSide(right, "right");
    return;
  }

  const side = parent.side === "left" ? "left" : "right";
  const dir = side === "left" ? -1 : 1;
  const total = topics.reduce(
    (sum, item) => sum + subtreeHeight(item) + SIBLING_GAP_Y,
    -SIBLING_GAP_Y,
  );
  let cursor = parent.y + parent.height / 2 - total / 2;

  topics.forEach((topic) => {
    const height = subtreeHeight(topic);
    const autoX = parent.x + dir * (LEVEL_GAP_X - 44);
    const autoY = cursor + (height - BRANCH_HEIGHT) / 2;
    const node: Placed = {
      id: topic.id,
      topic,
      depth,
      side,
      x: topic.position?.x ?? autoX,
      y: topic.position?.y ?? autoY,
      height: BRANCH_HEIGHT,
    };

    placed.push(node);
    edges.push({
      source: parent.id,
      target: topic.id,
      sourceHandle: side,
      targetHandle: side === "left" ? "in-right" : "in-left",
    });

    placeRadialChildren(node, topic.children, depth + 1, placed, edges);
    cursor += height + SIBLING_GAP_Y;
  });
}

function placeRightChildren(
  parent: Placed,
  topics: MindTopic[],
  depth: number,
  placed: Placed[],
  edges: Link[],
) {
  if (!parent.topic.expanded || topics.length === 0) return;

  const total = topics.reduce(
    (sum, item) => sum + subtreeHeight(item) + SIBLING_GAP_Y,
    -SIBLING_GAP_Y,
  );
  let cursor = parent.y + parent.height / 2 - total / 2;

  topics.forEach((topic) => {
    const height = subtreeHeight(topic);
    const autoX = parent.x + LEVEL_GAP_X;
    const autoY = cursor + (height - BRANCH_HEIGHT) / 2;
    const node: Placed = {
      id: topic.id,
      topic,
      depth,
      side: "right",
      x: topic.position?.x ?? autoX,
      y: topic.position?.y ?? autoY,
      height: BRANCH_HEIGHT,
    };

    placed.push(node);
    edges.push({
      source: parent.id,
      target: topic.id,
      sourceHandle: "right",
      targetHandle: "in-left",
    });

    placeRightChildren(node, topic.children, depth + 1, placed, edges);
    cursor += height + SIBLING_GAP_Y;
  });
}

function placeVerticalChildren(
  parent: Placed,
  topics: MindTopic[],
  depth: number,
  placed: Placed[],
  edges: Link[],
  compact: boolean,
) {
  if (!parent.topic.expanded || topics.length === 0) return;

  const siblingGap = compact ? ORG_SIBLING_GAP : VERTICAL_SIBLING_GAP;
  const levelGap = compact ? ORG_LEVEL_GAP : VERTICAL_LEVEL_GAP;
  const widths = topics.map((topic) => subtreeWidth(topic, siblingGap));
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + siblingGap * (topics.length - 1);
  const parentCenter = parent.x + nodeWidth(parent) / 2;
  let cursor = parentCenter - totalWidth / 2;

  topics.forEach((topic, index) => {
    const subtree = widths[index];
    const autoX = cursor + (subtree - BRANCH_WIDTH) / 2;
    const autoY = parent.y + parent.height + levelGap;
    const node: Placed = {
      id: topic.id,
      topic,
      depth,
      side: "down",
      x: topic.position?.x ?? autoX,
      y: topic.position?.y ?? autoY,
      height: BRANCH_HEIGHT,
    };

    placed.push(node);
    edges.push({
      source: parent.id,
      target: topic.id,
      sourceHandle: "bottom",
      targetHandle: "in-top",
    });

    placeVerticalChildren(node, topic.children, depth + 1, placed, edges, compact);
    cursor += subtree + siblingGap;
  });
}

export function buildMindFlow(
  root: MindTopic,
  layout: MindMapLayout = "radial",
): { nodes: Node<MindNodeData>[]; edges: Edge[] } {
  const placed: Placed[] = [];
  const links: Link[] = [];

  const rootPlaced: Placed = {
    id: root.id,
    topic: root,
    depth: 0,
    side: "center",
    x: root.position?.x ?? 0,
    y: root.position?.y ?? 0,
    height: 182,
  };

  placed.push(rootPlaced);

  if (layout === "right") {
    placeRightChildren(rootPlaced, root.children, 1, placed, links);
  } else if (layout === "vertical") {
    placeVerticalChildren(rootPlaced, root.children, 1, placed, links, false);
  } else if (layout === "org") {
    placeVerticalChildren(rootPlaced, root.children, 1, placed, links, true);
  } else {
    placeRadialChildren(rootPlaced, root.children, 1, placed, links);
  }

  const vertical = layout === "vertical" || layout === "org";

  const nodes: Node<MindNodeData>[] = placed.map((item) => {
    const sourcePosition = vertical
      ? Position.Bottom
      : layout === "right"
        ? Position.Right
        : item.side === "left"
          ? Position.Left
          : Position.Right;

    const targetPosition = vertical
      ? Position.Top
      : item.side === "left"
        ? Position.Right
        : Position.Left;

    return {
      id: item.id,
      type: item.side === "center" ? "mindRoot" : "mindBranch",
      position: { x: item.x, y: item.y },
      data: {
        title: item.topic.title,
        description: item.topic.description,
        isRoot: item.side === "center",
        expanded: item.topic.expanded,
        hasChildren: item.topic.children.length > 0,
        childCount: item.topic.children.length,
        icon: item.topic.icon ?? null,
        color: item.topic.color ?? "neutral",
        url: item.topic.url ?? "",
      },
      draggable: true,
      sourcePosition,
      targetPosition,
    };
  });

  const edges: Edge[] = links.map((link) => ({
    id: `${link.source}-${link.target}`,
    source: link.source,
    target: link.target,
    sourceHandle: link.sourceHandle,
    targetHandle: link.targetHandle,
    type: "mindEdge",
    selectable: false,
    focusable: false,
  }));

  return { nodes, edges };
}
