import type { SlideNode } from './types';

// Align individual centers while preserving each element's vertical position.
export function alignSlideNodesCenter(nodes: SlideNode[], targetX: number): SlideNode[] {
  return nodes.map(node => {
    const width = Number(node.style?.width) || node.width || node.measured?.width || 420;
    return {
      ...node,
      position: { ...node.position, x: targetX - width / 2 },
      data: node.data.kind === 'text' ? { ...node.data, align: 'center' } : node.data,
    };
  });
}

// Translate the entire composition on one axis. Never redistribute its elements.
export function centerSlideNodes(nodes: SlideNode[], direction: 'horizontal' | 'vertical', target: { x: number; y: number }) {
  if (!nodes.length) return { nodes, bounds: null };
  const sizes = nodes.map(node => ({
    width: Number(node.style?.width) || node.width || node.measured?.width || 420,
    height: Number(node.style?.height) || node.height || node.measured?.height || 260,
  }));
  const left = Math.min(...nodes.map(n => n.position.x));
  const top = Math.min(...nodes.map(n => n.position.y));
  const right = Math.max(...nodes.map((n, i) => n.position.x + sizes[i].width));
  const bottom = Math.max(...nodes.map((n, i) => n.position.y + sizes[i].height));
  const dx = direction === 'horizontal' ? target.x - (left + right) / 2 : 0;
  const dy = direction === 'vertical' ? target.y - (top + bottom) / 2 : 0;
  return {
    nodes: nodes.map(node => ({ ...node, position: { x: node.position.x + dx, y: node.position.y + dy } })),
    bounds: { x: left + dx, y: top + dy, width: right - left, height: bottom - top },
  };
}

// Organize only the selection when present; otherwise organize the whole canvas.
// Fixed gaps avoid overlap even when the original elements were stacked.
export function arrangeSlideNodes(nodes: SlideNode[], mode: 'row' | 'column' | 'grid'): SlideNode[] {
  const selection = nodes.filter(node => node.selected);
  const items = selection.length ? selection : nodes;
  if (items.length < 2) return nodes;
  const columns = mode === 'column' ? 1 : mode === 'row' ? items.length : Math.ceil(Math.sqrt(items.length));
  const widths = Array.from({ length: columns }, () => 0);
  const heights: number[] = [];
  items.forEach((node, i) => {
    const col = i % columns, row = Math.floor(i / columns);
    widths[col] = Math.max(widths[col], Number(node.style?.width) || node.width || node.measured?.width || 420);
    heights[row] = Math.max(heights[row] || 0, Number(node.style?.height) || node.height || node.measured?.height || 260);
  });
  const left = Math.min(...items.map(n => n.position.x));
  const top = Math.min(...items.map(n => n.position.y));
  const positions = new Map(items.map((node, i) => [node.id, {
    x: left + widths.slice(0, i % columns).reduce((sum, width) => sum + width + 40, 0),
    y: top + heights.slice(0, Math.floor(i / columns)).reduce((sum, height) => sum + height + 40, 0),
  }]));
  return nodes.map(node => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node);
}
