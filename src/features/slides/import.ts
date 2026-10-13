import { z } from 'zod';
import { MIND_ICONS } from '../mindmap/BrandIcons';
import type { SlideData } from './types';

export const MAX_SLIDE_FILE_BYTES = 10 * 1024 * 1024;
const number = z.number().finite();
const size = number.min(1).max(20000);
const color = z.string().regex(/^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|transparent)$/i, 'Use uma cor hexadecimal, como #ffffff.');
const media = z.string().max(MAX_SLIDE_FILE_BYTES).refine(value => {
  if (/^data:image\/(png|jpeg|webp|gif|avif);base64,[a-z0-9+/=\r\n]+$/i.test(value)) return true;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}, 'Use um link http/https ou uma imagem incorporada PNG, JPEG, WebP, GIF ou AVIF.');
const item = z.object({
  kind: z.enum(['text', 'image', 'video', 'drawing', 'logo']),
  text: z.string().max(50000).optional(),
  name: z.string().max(200).optional(),
  src: media.optional(),
  icon: z.string().refine(value => MIND_ICONS.some(icon => icon.id === value && value !== 'none'), 'Logo desconhecido.').optional(),
  color: color.default('#ffffff'),
  background: color.default('transparent'),
  fontSize: number.min(12).max(160).default(36),
  bold: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  naturalWidth: size.optional(),
  naturalHeight: size.optional(),
  path: z.string().max(100000).regex(/^[MmLlHhVvCcSsQqTtAaZzEe0-9+.,\s-]+$/).optional(),
  strokeWidth: number.min(0.1).max(100).optional(),
  viewWidth: size.optional(),
  viewHeight: size.optional(),
}).superRefine((data, ctx) => {
  const required = data.kind === 'text' ? ['text'] : data.kind === 'logo' ? ['icon'] : data.kind === 'drawing' ? ['path', 'viewWidth', 'viewHeight', 'strokeWidth'] : ['src'];
  for (const key of required) if (data[key as keyof typeof data] === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `Falta ${key} no elemento ${data.kind}.` });
  if (data.kind === 'video' && data.src?.startsWith('data:')) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['src'], message: 'Vídeos precisam de um link http/https direto.' });
});
const schema = z.object({
  title: z.string().trim().min(1).max(140).default('Apresentação importada'),
  data: z.object({
    kind: z.literal('slides'),
    version: z.literal(1),
    background: color.optional(),
    showGrid: z.boolean().optional(),
    viewport: z.object({ x: number.min(-1000000).max(1000000), y: number.min(-1000000).max(1000000), zoom: number.min(.05).max(5) }).default({ x: 80, y: 80, zoom: 1 }),
    nodes: z.array(z.object({
      id: z.string().min(1).max(150).optional(),
      type: z.literal('slide').default('slide'),
      position: z.object({ x: number.min(-100000).max(100000), y: number.min(-100000).max(100000) }),
      style: z.object({ width: size, height: size }),
      zIndex: number.int().min(-10000).max(10000).optional(),
      data: item,
    })).min(1).max(500),
  }),
});

export function parseSlideFile(text: string): { title: string; data: SlideData } {
  if (new TextEncoder().encode(text).length > MAX_SLIDE_FILE_BYTES) throw new Error('O arquivo deve ter no máximo 10 MB.');
  let input: unknown;
  try { input = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('O arquivo não contém um JSON válido. Peça um arquivo no formato Organizafyd.'); }
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Arquivo incompatível em ${issue.path.join('.') || 'apresentação'}. ${issue.message}`);
  }
  // Only explicitly supported fields survive validation. Never import storage ownership,
  // React Flow parent links, hidden/locked state, arbitrary CSS or remote record IDs.
  const nodes = result.data.data.nodes.map(node => ({ ...node, id: crypto.randomUUID() }));
  return { title: result.data.title, data: { ...result.data.data, nodes } as SlideData };
}

export async function readSlideFile(file: File) {
  if (!file.name.toLowerCase().endsWith('.json')) throw new Error('Selecione um arquivo .json de slides do Organizafyd.');
  if (file.size > MAX_SLIDE_FILE_BYTES) throw new Error('O arquivo deve ter no máximo 10 MB.');
  return parseSlideFile(await file.text());
}
