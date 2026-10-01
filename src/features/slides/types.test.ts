import { describe, expect, it } from 'vitest';
import { cleanNodes, drawingNode, emptySlides, fitMediaNode, isSlideData, safeMediaUrl } from './types';
import type { SlideNode } from './types';

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

describe('native media proportions', () => {
  const media = (kind: 'image' | 'video' = 'image'): SlideNode => ({ id: 'media', type: 'slide', position: { x: 100, y: 100 }, style: { width: 480, height: 300 }, data: { kind, src: 'https://example.com/file', color: '#fff', background: 'transparent', fontSize: 24 } });
  it.each([[1080, 1920], [1920, 1080], [1000, 1000], [4000, 500]])('fits %s × %s without empty borders or crop', (width, height) => {
    const fitted = fitMediaNode(media(), width, height);
    expect(fitted.width / fitted.height).toBeCloseTo(width / height, 8);
    expect(fitted.width).toBeLessThanOrEqual(480);
    expect(fitted.height).toBeLessThanOrEqual(300);
    expect(fitted.position.x + fitted.width / 2).toBeCloseTo(340);
    expect(fitted.position.y + fitted.height / 2).toBeCloseTo(250);
    expect(fitted.data.naturalWidth).toBe(width);
    expect(fitted.data.src).toBe(media().data.src);
  });
  it('preserves manual size when media metadata loads again', () => {
    const fitted = fitMediaNode(media('video'), 1080, 1920);
    const resized = { ...fitted, width: 270, height: 480, style: { width: 270, height: 480 } };
    expect(fitMediaNode(resized, 1080, 1920)).toBe(resized);
  });
  it('does not upscale small originals or accept invalid metadata', () => {
    const node = media();
    expect(fitMediaNode(node, 40, 80).style).toEqual({ width: 40, height: 80 });
    expect(fitMediaNode(node, 0, 0)).toBe(node);
    expect(fitMediaNode(node, NaN, 300)).toBe(node);
  });
});
