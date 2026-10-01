import { useContext } from 'react';
import { SlideContext } from './context';
import { VideoSlide } from './VideoSlide';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import type { SlideNode as SlideNodeType } from './types';
export function SlideNode({ id, data, selected }: NodeProps<SlideNodeType>) {
  const ctx = useContext(SlideContext);
  return <>
    <NodeResizer isVisible={selected && !ctx.presenting && ctx.editing !== id} minWidth={data.kind === 'drawing' ? 12 : 100} minHeight={data.kind === 'drawing' ? 12 : 60} keepAspectRatio={data.kind !== 'text'} onResizeStart={ctx.checkpoint} lineStyle={{ borderColor: '#a1a1aa' }} handleStyle={{ background: '#fafafa', borderColor: '#71717a', width: 8, height: 8 }} />
    <div className={`slide-item ${data.kind === 'drawing' ? 'slide-drawing' : ''}`} style={{ background: data.background, color: data.color }} onDoubleClick={e => { if (data.kind === 'text' && !ctx.presenting) { e.stopPropagation(); ctx.checkpoint(); ctx.edit(id); } }}>
      {data.kind === 'text' && (ctx.editing === id && !ctx.presenting ?
        <textarea autoFocus aria-label="Texto do slide" className="nodrag nowheel slide-text" value={data.text || ''} style={{ fontSize: data.fontSize, fontWeight: data.bold ? 700 : 400, textAlign: data.align || 'left' }} onChange={e => ctx.patch(id, e.target.value)} onBlur={() => ctx.edit(null)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') ctx.edit(null); }} /> :
        <div className="slide-text" style={{ fontSize: data.fontSize, fontWeight: data.bold ? 700 : 400, textAlign: data.align || 'left' }}>{data.text}</div>)}
      {data.kind === 'image' && <img draggable={false} src={data.src} alt={data.name || 'Imagem do slide'} onError={e => { e.currentTarget.alt = 'Não foi possível carregar esta imagem'; }} />}
      {data.kind === 'video' && <VideoSlide src={data.src} name={data.name} presenting={ctx.presenting} />}
      {data.kind === 'drawing' && <svg width="100%" height="100%" viewBox={`0 0 ${data.viewWidth} ${data.viewHeight}`} preserveAspectRatio="none"><path d={data.path} fill="none" stroke={data.color} strokeWidth={data.strokeWidth} strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </div>
  </>;
}
