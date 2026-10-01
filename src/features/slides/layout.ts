import type { SlideNode } from './types';

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
