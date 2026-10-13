import { Video } from 'lucide-react';
import { BrandIcon } from '../mindmap/BrandIcons';
import type { SlideNode } from './types';

// A lightweight preview: never mount players or a second editable canvas.
export function SlidePreview({ nodes }: { nodes: SlideNode[] }) {
  if (!nodes.length) return <span className="text-xs text-muted-foreground">Tela em branco</span>;
  const items = nodes.map(node => ({ node,
    width: Number(node.style?.width) || node.width || 420,
    height: Number(node.style?.height) || node.height || 260,
  }));
  const x = Math.min(...items.map(({ node }) => node.position.x)) - 30;
  const y = Math.min(...items.map(({ node }) => node.position.y)) - 30;
  const width = Math.max(...items.map(({ node, width }) => node.position.x + width)) - x + 30;
  const height = Math.max(...items.map(({ node, height }) => node.position.y + height)) - y + 30;
  return <svg aria-hidden="true" className="h-full w-full p-3" viewBox={`${x} ${y} ${width} ${height}`}>
    {items.sort((a, b) => (a.node.zIndex || 0) - (b.node.zIndex || 0)).map(({ node, width, height }) => {
      const d = node.data;
      return <foreignObject key={node.id} x={node.position.x} y={node.position.y} width={width} height={height}>
        <div style={{ width: '100%', height: '100%', overflow: 'hidden', color: d.color, background: d.background }}>
          {d.kind === 'logo' && <BrandIcon name={d.icon} width="100%" height="100%" />}
          {d.kind === 'image' && <img loading="lazy" src={d.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
          {d.kind === 'text' && <div style={{ padding: 24, fontSize: d.fontSize, fontWeight: d.bold ? 700 : 400, textAlign: d.align || 'left', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.3 }}>{d.text}</div>}
          {d.kind === 'video' && <div style={{ display: 'grid', placeItems: 'center', height: '100%', background: '#18181b' }}><Video size={Math.min(width, height) / 3} /></div>}
          {d.kind === 'drawing' && <svg width="100%" height="100%" viewBox={`0 0 ${d.viewWidth} ${d.viewHeight}`} preserveAspectRatio="none"><path d={d.path} fill="none" stroke={d.color} strokeWidth={d.strokeWidth} strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </div>
      </foreignObject>;
    })}
  </svg>;
}
