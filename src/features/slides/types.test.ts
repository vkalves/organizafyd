import { describe, expect, it } from 'vitest';
import { cleanNodes, drawingNode, emptySlides, isSlideData, safeMediaUrl } from './types';

describe('freeform slide documents', () => {
  it('distinguishes presentations from existing mind maps', () => {
    expect(isSlideData(emptySlides())).toBe(true);
    expect(isSlideData({ root: { title: 'My map' } })).toBe(false);
    expect(isSlideData(null)).toBe(false);
  });
  it('keeps a drawing in world coordinates, including negative space and single dots', () => {
    const node = drawingNode([{ x: -40, y: 20 }, { x: 100, y: -30 }], '#fff', 3);
    expect(node.position).toEqual({ x: -45, y: -35 });
    expect(node.data.path).toBe('M5,55 L145,5');
    expect(node.style).toEqual({ width: 150, height: 60 });
    expect(drawingNode([{ x: 0, y: 0 }], '#fff', 2).data.path).toContain('l0.01,0');
  });
  it('persists layout and appearance without transient selection or dragging state', () => {
    const node = { ...drawingNode([{ x: 1, y: 2 }], '#fff', 2), selected: true, dragging: true };
    const [stored] = cleanNodes([node]);
    expect(stored).not.toHaveProperty('selected');
    expect(stored).not.toHaveProperty('dragging');
    expect(stored.position).toEqual(node.position);
    expect(stored.data).toEqual(node.data);
  });
  it('rejects executable and local media URLs', () => {
    expect(safeMediaUrl('javascript:alert(1)')).toBeNull();
    expect(safeMediaUrl('file:///private/video.mp4')).toBeNull();
    expect(safeMediaUrl('data:text/html,test')).toBeNull();
    expect(safeMediaUrl('https://example.com/video.mp4')).toBe('https://example.com/video.mp4');
  });
});
