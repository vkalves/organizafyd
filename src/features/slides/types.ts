import type { Node, Viewport } from '@xyflow/react';

export type SlideItem = {
  kind: 'text' | 'image' | 'video' | 'drawing';
  text?: string;
  src?: string;
  storagePath?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  name?: string;
  color: string;
  background: string;
  fontSize: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  path?: string;
  strokeWidth?: number;
  viewWidth?: number;
  viewHeight?: number;
};
export type SlideNode = Node<SlideItem, 'slide'>;
export type SlideData = { kind: 'slides'; version: 1; nodes: SlideNode[]; viewport: Viewport };
export type SlideRow = { id: string; title: string; data: SlideData; updated_at: string };
export const emptySlides = (): SlideData => ({ kind: 'slides', version: 1, nodes: [], viewport: { x: 80, y: 80, zoom: 1 } });
export function isSlideData(data: unknown): data is SlideData {
  return !!data && typeof data === 'object' && 'kind' in data && data.kind === 'slides';
}
export function cleanNodes(nodes: SlideNode[]): SlideNode[] {
  return nodes.map(({ id, type, position, data, style, width, height, zIndex }) => ({ id, type, position, data, style, width, height, zIndex }));
}
export function safeMediaUrl(value: string) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function drawingNode(points: { x: number; y: number }[], color: string, strokeWidth: number): SlideNode {
  const pad = strokeWidth + 2;
  const minX = Math.min(...points.map(p => p.x)) - pad;
  const minY = Math.min(...points.map(p => p.y)) - pad;
  const w = Math.max(1, Math.max(...points.map(p => p.x)) - minX + pad);
  const h = Math.max(1, Math.max(...points.map(p => p.y)) - minY + pad);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p.x - minX},${p.y - minY}`).join(' ') + (points.length === 1 ? ' l0.01,0' : '');
  return { id: crypto.randomUUID(), type: 'slide', position: { x: minX, y: minY }, style: { width: w, height: h }, data: { kind: 'drawing', color, background: 'transparent', fontSize: 24, path, strokeWidth, viewWidth: w, viewHeight: h } };
}

// Fit the frame to the actual media, without changing the file or enlarging its pixels.
// Run once per file so reopening it does not undo the user's manual resizing.
export function fitMediaNode(node: SlideNode, width: number, height: number): SlideNode {
  if (!['image', 'video'].includes(node.data.kind) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return node;
  if (node.data.naturalWidth === width && node.data.naturalHeight === height) return node;
  const boxWidth = Number(node.style?.width) || node.width || 480;
  const boxHeight = Number(node.style?.height) || node.height || 300;
  const scale = Math.min(1, boxWidth / width, boxHeight / height);
  const nextWidth = width * scale;
  const nextHeight = height * scale;
  return {
    ...node,
    position: { x: node.position.x + (boxWidth - nextWidth) / 2, y: node.position.y + (boxHeight - nextHeight) / 2 },
    width: nextWidth, height: nextHeight,
    style: { ...node.style, width: nextWidth, height: nextHeight },
    data: { ...node.data, naturalWidth: width, naturalHeight: height },
  };
}
