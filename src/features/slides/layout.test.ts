import { describe, expect, it } from 'vitest';
import { centerSlideNodes } from './layout';
import type { SlideNode } from './types';
const nodes: SlideNode[] = [
  { id: 'a', type: 'slide', position: { x: -90, y: 100 }, style: { width: 120, height: 200 }, data: { kind: 'image', color: '#fff', background: 'transparent', fontSize: 24 } },
  { id: 'b', type: 'slide', position: { x: 700, y: -200 }, style: { width: 400, height: 100 }, data: { kind: 'text', color: '#fff', background: 'transparent', fontSize: 24 } },
];
const target = { x: 50, y: 500 };
describe('centering without redistribution', () => {
  it.each(['horizontal', 'vertical'] as const)('preserves every relative distance when centering %s', direction => {
    const result = centerSlideNodes(nodes, direction, target);
    const [a, b] = result.nodes;
    expect(b.position.x - a.position.x).toBe(nodes[1].position.x - nodes[0].position.x);
    expect(b.position.y - a.position.y).toBe(nodes[1].position.y - nodes[0].position.y);
    expect(a.style).toBe(nodes[0].style);
    expect(b.data).toBe(nodes[1].data);
    expect(result.nodes.map(n => n.id)).toEqual(['a', 'b']);
    expect(nodes[0].position).toEqual({ x: -90, y: 100 });
  });
  it('horizontal only shifts left/right and centers the whole bounding box', () => {
    const result = centerSlideNodes(nodes, 'horizontal', target);
    expect(result.nodes.map(n => n.position.y)).toEqual(nodes.map(n => n.position.y));
    expect(result.bounds.x + result.bounds.width / 2).toBe(target.x);
  });
  it('vertical only shifts up/down and centers the whole bounding box', () => {
    const result = centerSlideNodes(nodes, 'vertical', target);
    expect(result.nodes.map(n => n.position.x)).toEqual(nodes.map(n => n.position.x));
    expect(result.bounds.y + result.bounds.height / 2).toBe(target.y);
  });
  it('handles an empty panel and a single element', () => {
    expect(centerSlideNodes([], 'vertical', target)).toEqual({ nodes: [], bounds: null });
    const result = centerSlideNodes([nodes[0]], 'horizontal', target);
    expect(result.nodes[0].position.x + 60).toBe(target.x);
    expect(result.nodes[0].position.y).toBe(nodes[0].position.y);
  });
});
