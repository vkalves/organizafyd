import { describe, expect, it } from 'vitest';
import { arrangeSlideNodes } from './layout';
import type { SlideNode } from './types';
const nodes: SlideNode[] = [
  { id: 'a', type: 'slide', position: { x: -90, y: 100 }, style: { width: 120, height: 200 }, data: { kind: 'image', color: '#fff', background: 'transparent', fontSize: 24 } },
  { id: 'b', type: 'slide', position: { x: 700, y: -200 }, style: { width: 400, height: 100 }, data: { kind: 'text', color: '#fff', background: 'transparent', fontSize: 24 } },
];
describe('slide arrangement', () => {
  it('centers a column without resizing or overlapping elements', () => {
    const result = arrangeSlideNodes(nodes, 'vertical');
    const [a, b] = result.nodes;
    expect(a.position.x + 60).toBe(b.position.x + 200);
    expect(b.position.y - (a.position.y + 200)).toBe(48);
    expect(a.style).toBe(nodes[0].style);
    expect(b.data).toBe(nodes[1].data);
    expect(nodes[0].position).toEqual({ x: -90, y: 100 });
  });
  it('centers a row and preserves order when switching directions', () => {
    const column = arrangeSlideNodes(nodes, 'vertical');
    const row = arrangeSlideNodes(column.nodes, 'horizontal');
    const [a, b] = row.nodes;
    expect(a.position.y + 100).toBe(b.position.y + 50);
    expect(b.position.x - (a.position.x + 120)).toBe(48);
    expect(row.nodes.map(n => n.id)).toEqual(['a', 'b']);
    expect(row.bounds.width).toBe(568);
    expect(row.bounds.height).toBe(200);
  });
  it('handles an empty panel and a single element', () => {
    expect(arrangeSlideNodes([], 'vertical')).toEqual({ nodes: [], bounds: null });
    expect(arrangeSlideNodes([nodes[0]], 'horizontal').nodes[0].position).toEqual(nodes[0].position);
  });
});
