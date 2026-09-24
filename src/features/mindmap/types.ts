import type { MindIconName } from "./BrandIcons";

export type MindTopicColor =
  | "neutral"
  | "blue"
  | "violet"
  | "pink"
  | "green"
  | "orange"
  | "red";

export type MindTopic = {
  id: string;
  title: string;
  description: string;
  expanded: boolean;
  children: MindTopic[];
  icon?: MindIconName | null;
  color?: MindTopicColor;
  url?: string;
};

export type MindMapData = {
  root: MindTopic;
};

export function createTopic(title = "Novo bloco", description = ""): MindTopic {
  return {
    id: crypto.randomUUID(),
    title,
    description,
    expanded: true,
    children: [],
    icon: null,
    color: "neutral",
    url: "",
  };
}

export function createMindMapData(title: string, description = ""): MindMapData {
  return {
    root: {
      id: crypto.randomUUID(),
      title,
      description,
      expanded: true,
      children: [],
      icon: null,
      color: "neutral",
      url: "",
    },
  };
}

export function cloneTopicWithNewIds(topic: MindTopic): MindTopic {
  return {
    ...topic,
    id: crypto.randomUUID(),
    children: topic.children.map(cloneTopicWithNewIds),
  };
}

export function findTopic(root: MindTopic, id: string): MindTopic | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findTopic(child, id);
    if (found) return found;
  }
  return null;
}

export function findParent(root: MindTopic, id: string): MindTopic | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

export function mapTree(root: MindTopic, mapper: (node: MindTopic) => MindTopic): MindTopic {
  const next = mapper(root);
  return {
    ...next,
    children: next.children.map((child) => mapTree(child, mapper)),
  };
}

export function countTopics(root: MindTopic): number {
  return 1 + root.children.reduce((sum, child) => sum + countTopics(child), 0);
}
