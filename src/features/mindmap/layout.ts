import type { Edge, Node } from "@xyflow/react";
import type { MindTopic } from "./types";

export const ROOT_WIDTH = 280;
export const BRANCH_WIDTH = 240;
export const BRANCH_HEIGHT = 92;
const LEVEL_GAP_X = 360;
const SIBLING_GAP_Y = 28;

export type MindNodeData = {
  title: string;
  description: string;
  isRoot: boolean;
  expanded: boolean;
  hasChildren: boolean;
};

type Placed = {
  id: string;
  topic: MindTopic;
  depth: number;
  side: "center" | "left" | "right";
  x: number;
  y: number;
  height: number;
};

function subtreeHeight(topic: MindTopic): number {
  if (!topic.expanded || topic.children.length === 0) return BRANCH_HEIGHT;
  const children = topic.children.reduce((sum, child) => sum + subtreeHeight(child) + SIBLING_GAP_Y, -SIBLING_GAP_Y);
  return Math.max(BRANCH_HEIGHT, children);
}

function placeChildren(
  parent: Placed,
  topics: MindTopic[],
  depth: number,
  placed: Placed[],
  edges: { source: string; target: string; sourceHandle?: string; targetHandle?: string }[],
) {
  if (!parent.topic.expanded || topics.length === 0) return;

  const mid = Math.ceil(topics.length / 2);
  const left = topics.slice(0, mid);
  const right = topics.slice(mid);

  const layoutSide = (items: MindTopic[], side: "left" | "right") => {
    const dir = side === "left" ? -1 : 1;
    const total = items.reduce((sum, item) => sum + subtreeHeight(item) + SIBLING_GAP_Y, -SIBLING_GAP_Y);
    let cursor = parent.y + parent.height / 2 - total / 2;

    items.forEach((topic) => {
      const height = subtreeHeight(topic);
      const node: Placed = {
        id: topic.id,
        topic,
        depth,
        side,
        x: parent.x + dir * LEVEL_GAP_X,
        y: cursor + (height - BRANCH_HEIGHT) / 2,
        height: BRANCH_HEIGHT,
      };
      placed.push(node);
      edges.push({
        source: parent.id,
        target: topic.id,
        sourceHandle: parent.side === "center" ? side : parent.side,
        targetHandle: side === "left" ? "in-right" : "in-left",
      });
      placeChildren(node, topic.children, depth + 1, placed, edges);
      cursor += height + SIBLING_GAP_Y;
    });
  };

  if (parent.side === "center") {
    layoutSide(left, "left");
    layoutSide(right, "right");
    return;
  }

  const dir = parent.side === "left" ? -1 : 1;
  const total = topics.reduce((sum, item) => sum + subtreeHeight(item) + SIBLING_GAP_Y, -SIBLING_GAP_Y);
  let cursor = parent.y + parent.height / 2 - total / 2;
  topics.forEach((topic) => {
    const height = subtreeHeight(topic);
    const node: Placed = {
      id: topic.id,
      topic,
      depth,
      side: parent.side,
      x: parent.x + dir * (LEVEL_GAP_X - 40),
      y: cursor + (height - BRANCH_HEIGHT) / 2,
      height: BRANCH_HEIGHT,
    };
    placed.push(node);
    edges.push({
      source: parent.id,
      target: topic.id,
      sourceHandle: parent.side,
      targetHandle: parent.side === "left" ? "in-right" : "in-left",
    });
    placeChildren(node, topic.children, depth + 1, placed, edges);
    cursor += height + SIBLING_GAP_Y;
  });
}

export function buildMindFlow(root: MindTopic): { nodes: Node<MindNodeData>[]; edges: Edge[] } {
  const placed: Placed[] = [];
  const links: { source: string; target: string; sourceHandle?: string; targetHandle?: string }[] = [];

  const rootPlaced: Placed = {
    id: root.id,
    topic: root,
    depth: 0,
    side: "center",
    x: 0,
    y: 0,
    height: 168,
  };
  placed.push(rootPlaced);
  placeChildren(rootPlaced, root.children, 1, placed, links);

  const nodes: Node<MindNodeData>[] = placed.map((item) => ({
    id: item.id,
    type: item.side === "center" ? "mindRoot" : "mindBranch",
    position: { x: item.x, y: item.y },
    data: {
      title: item.topic.title,
      description: item.topic.description,
      isRoot: item.side === "center",
      expanded: item.topic.expanded,
      hasChildren: item.topic.children.length > 0,
    },
    draggable: false,
    sourcePosition: item.side === "left" ? ("left" as const) : ("right" as const),
    targetPosition: item.side === "left" ? ("right" as const) : ("left" as const),
  }));

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
