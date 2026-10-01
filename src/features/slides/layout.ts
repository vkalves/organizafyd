import type { SlideNode } from './types';

export function arrangeSlideNodes(nodes: SlideNode[], direction: 'horizontal' | 'vertical') {
  if (!nodes.length) return { nodes, bounds: null };
  const sizes = nodes.map(node => ({
    width: Number(node.style?.width) || node.width || node.measured?.width || 420,
    height: Number(node.style?.height) || node.height || node.measured?.height || 260,
  }));
  const left = Math.min(...nodes.map(n => n.position.x));
  const top = Math.min(...nodes.map(n => n.position.y));
  const right = Math.max(...nodes.map((n, i) => n.position.x + sizes[i].width));
  const bottom = Math.max(...nodes.map((n, i) => n.position.y + sizes[i].height));
  const gap = 48;
  const horizontal = direction === 'horizontal';
  const width = horizontal ? sizes.reduce((sum, s) => sum + s.width, 0) + gap * (nodes.length - 1) : Math.max(...sizes.map(s => s.width));
  const height = horizontal ? Math.max(...sizes.map(s => s.height)) : sizes.reduce((sum, s) => sum + s.height, 0) + gap * (nodes.length - 1);
  const x = (left + right - width) / 2;
  const y = (top + bottom - height) / 2;
  let offset = 0;
  // Keep insertion order when switching between row and column.
  const arranged = nodes.map((node, i) => {
    const size = sizes[i];
    const position = horizontal
      ? { x: x + offset, y: y + (height - size.height) / 2 }
      : { x: x + (width - size.width) / 2, y: y + offset };
    offset += (horizontal ? size.width : size.height) + gap;
    return { ...node, position };
  });
  return { nodes: arranged, bounds: { x, y, width, height } };
}
