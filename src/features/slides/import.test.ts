import { describe, expect, it } from 'vitest';
import { parseSlideFile, readSlideFile, MAX_SLIDE_FILE_BYTES } from './import';
const sample = () => ({ title: 'Meu slide', data: { kind: 'slides', version: 1, background: '#000000', showGrid: false, nodes: [{ id: 'a', position: { x: 20, y: 40 }, style: { width: 420, height: 120 }, data: { kind: 'text', text: 'Olá' } }] } });
describe('slide file validation', () => {
  it('imports editable content, defaults and board styling with fresh IDs', () => {
    const result = parseSlideFile(JSON.stringify(sample()));
    expect(result.title).toBe('Meu slide');
    expect(result.data).toMatchObject({ background: '#000000', showGrid: false, viewport: { x: 80, y: 80, zoom: 1 } });
    expect(result.data.nodes[0].id).not.toBe('a');
    expect(result.data.nodes[0]).toMatchObject({ type: 'slide', data: { text: 'Olá', color: '#ffffff', fontSize: 36 }, style: { width: 420, height: 120 } });
  });
  it('strips storage paths, hidden flags, foreign parents and arbitrary CSS', () => {
    const input = sample();
    Object.assign(input.data.nodes[0], { hidden: true, parentId: 'other' });
    Object.assign(input.data.nodes[0].style, { position: 'fixed', backgroundImage: 'url(https://example.com)' });
    Object.assign(input.data.nodes[0].data, { storagePath: 'other-user/file' });
    const node = parseSlideFile(JSON.stringify(input)).data.nodes[0];
    expect(node.hidden).toBeUndefined(); expect(node.parentId).toBeUndefined();
    expect(node.data.storagePath).toBeUndefined(); expect(node.style).toEqual({ width: 420, height: 120 });
  });
  it.each(['javascript:alert(1)', 'file:///tmp/a', 'data:image/svg+xml;base64,AAAA', 'blob:https://example.com/a'])('rejects unsupported media %s', src => {
    const input = sample();
    Object.assign(input.data.nodes[0].data, { kind: 'image', src });
    expect(() => parseSlideFile(JSON.stringify(input))).toThrow('incompatível');
  });
  it('accepts embedded raster images and known logos', () => {
    const input = sample();
    Object.assign(input.data.nodes[0].data, { kind: 'image', src: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(parseSlideFile(JSON.stringify(input)).data.nodes[0].data.kind).toBe('image');
    Object.assign(input.data.nodes[0].data, { kind: 'logo', icon: 'telegram' });
    expect(parseSlideFile(JSON.stringify(input)).data.nodes[0].data.icon).toBe('telegram');
  });
  it('rejects missing media, unknown logos, unsupported versions and invalid dimensions', () => {
    for (const patch of [{ kind: 'image' }, { kind: 'logo', icon: 'unknown' }, { kind: 'drawing' }]) {
      const input = sample(); Object.assign(input.data.nodes[0].data, patch);
      expect(() => parseSlideFile(JSON.stringify(input))).toThrow();
    }
    const input = sample(); input.data.version = 2;
    expect(() => parseSlideFile(JSON.stringify(input))).toThrow();
    input.data.version = 1; input.data.nodes[0].style.width = -1;
    expect(() => parseSlideFile(JSON.stringify(input))).toThrow();
  });
  it('rejects malformed, oversized and non-JSON files', async () => {
    expect(() => parseSlideFile('{')).toThrow('JSON válido');
    await expect(readSlideFile(new File(['{}'], 'slide.pptx'))).rejects.toThrow('.json');
    await expect(readSlideFile(new File([new Uint8Array(MAX_SLIDE_FILE_BYTES + 1)], 'slide.json'))).rejects.toThrow('10 MB');
  });
});
