import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlidesEditor } from './SlidesEditor';
import { emptySlides } from './types';

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { callback: ResizeObserverCallback; constructor(callback: ResizeObserverCallback) { this.callback = callback; } observe(target: Element) { queueMicrotask(() => this.callback([{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry], this as unknown as ResizeObserver)); } unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1000 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 700 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 700 });
  vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1; });
});
beforeEach(() => localStorage.clear());
afterEach(() => cleanup());
const row = () => ({ id: 'board-test', title: 'Apresentação', data: emptySlides(), updated_at: '2026-10-01T00:00:00Z' });
function setup(onSave = vi.fn().mockResolvedValue(true)) {
  const onBack = vi.fn();
  const onUpload = vi.fn().mockResolvedValue({ src: 'https://example.com/a.mp4', storagePath: 'tester/slides/a.mp4' });
  const view = render(<SlidesEditor row={row()} userId="tester" onSave={onSave} onBack={onBack} onUpload={onUpload} />);
  return { onSave, onBack, onUpload, ...view };
}

describe('SlidesEditor interaction and persistence', () => {
  it('adds editable text, saves its content, and restores after reopening', async () => {
    const { onSave, unmount } = setup();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Adicionar conteúdo' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Adicionar texto' }));
    const text = await screen.findByRole('textbox', { name: 'Texto do slide' });
    fireEvent.change(text, { target: { value: 'Minha ideia' } });
    fireEvent.blur(text);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agora' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvo'));
    expect(onSave.mock.lastCall[1].nodes[0].data.text).toBe('Minha ideia');
    const data = onSave.mock.lastCall[1];
    unmount();
    render(<SlidesEditor row={{ ...row(), data }} userId="tester" onSave={onSave} onBack={vi.fn()} onUpload={vi.fn()} />);
    expect(await screen.findByText('Minha ideia')).toBeVisible();
  });
  it('serializes concurrent saves so the latest edit wins', async () => {
    let release: (value: boolean) => void;
    const onSave = vi.fn().mockImplementationOnce(() => new Promise<boolean>(resolve => { release = resolve; })).mockResolvedValue(true);
    setup(onSave);
    fireEvent.change(screen.getByLabelText('Título da apresentação'), { target: { value: 'Primeiro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agora' }));
    fireEvent.change(screen.getByLabelText('Título da apresentação'), { target: { value: 'Segundo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agora' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => release(true));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.lastCall[0]).toBe('Segundo');
  });
  it('retains a recovery copy and blocks back when saving fails, then retries', async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    const { onBack } = setup(onSave);
    fireEvent.change(screen.getByLabelText('Título da apresentação'), { target: { value: 'Não perder' } });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar aos slides' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Falha ao salvar'));
    expect(onBack).not.toHaveBeenCalled();
    expect(localStorage.getItem('organizafyd:slides:tester:board-test')).toContain('Não perder');
    onSave.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar aos slides' }));
    await waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(localStorage.getItem('organizafyd:slides:tester:board-test')).toBeNull();
  });
  it('uploads video and persists its durable source and storage path', async () => {
    const { onSave, onUpload } = setup();
    const input = document.querySelector('input[accept^="video/"]')!;
    const file = new File(['test video'], 'video.mp4', { type: 'video/mp4' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    expect(onUpload).toHaveBeenCalledWith(file);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agora' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.lastCall[1].nodes[0].data).toMatchObject({ kind: 'video', src: 'https://example.com/a.mp4', storagePath: 'tester/slides/a.mp4' });
  });
  it('restores an unsaved recovery draft without exposing another user’s draft', async () => {
    localStorage.setItem('organizafyd:slides:tester:board-test', JSON.stringify({ title: 'Recuperado', data: emptySlides(), at: Date.now() + 100000 }));
    setup();
    expect(screen.getByLabelText('Título da apresentação')).toHaveValue('Recuperado');
    cleanup();
    render(<SlidesEditor row={row()} userId="another-user" onSave={vi.fn().mockResolvedValue(true)} onBack={vi.fn()} onUpload={vi.fn()} />);
    expect(screen.getByLabelText('Título da apresentação')).toHaveValue('Apresentação');
  });
  it('hides editing controls in presentation and keeps the same canvas mounted', async () => {
    setup();
    const canvas = screen.getByTestId('slides-editor');
    fireEvent.click(screen.getByRole('button', { name: 'Apresentar' }));
    expect(canvas).toHaveClass('is-presenting');
    expect(screen.queryByRole('button', { name: 'Adicionar conteúdo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mover painel' })).toBeVisible();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('slides-editor')).toBe(canvas);
    expect(canvas).not.toHaveClass('is-presenting');
  });
  it('undoes and redoes inserting a text block', async () => {
    const { onSave } = setup();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Adicionar conteúdo' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Adicionar texto' }));
    fireEvent.blur(await screen.findByLabelText('Texto do slide'));
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agora' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvo'));
    // No save is needed if undo returned exactly to the original empty document.
    if (onSave.mock.calls.length) expect(onSave.mock.lastCall[1].nodes).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Refazer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agora' }));
    await waitFor(() => expect(onSave.mock.lastCall[1].nodes).toHaveLength(1));
  });
  it('undoes and redoes changes during presentation', async () => {
    setup();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Adicionar conteúdo' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Adicionar texto' }));
    fireEvent.blur(await screen.findByLabelText('Texto do slide'));
    fireEvent.click(screen.getByRole('button', { name: 'Apresentar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(screen.queryByText('Escreva sua ideia')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refazer' }));
    expect(await screen.findByText('Escreva sua ideia')).toBeVisible();
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(screen.queryByText('Escreva sua ideia')).toBeNull();
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(await screen.findByText('Escreva sua ideia')).toBeVisible();
  });
  it('toggles the controls on background clicks in both modes and restores them on Escape', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Mover painel' }));
    const pane = document.querySelector('.react-flow__pane')!;
    fireEvent.click(pane);
    expect(screen.queryByRole('button', { name: 'Mover painel' })).toBeNull();
    fireEvent.click(pane);
    expect(screen.getByRole('button', { name: 'Mover painel' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Mover painel' }));
    expect(screen.getByRole('button', { name: 'Lápis' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Apresentar' }));
    fireEvent.click(pane);
    expect(screen.queryByRole('button', { name: 'Sair da apresentação' })).toBeNull();
    fireEvent.click(pane);
    expect(screen.getByRole('button', { name: 'Sair da apresentação' })).toBeVisible();
    fireEvent.click(pane);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Mover painel' })).toBeVisible();
  });

  it('fits an existing portrait image and saves the dimensions across undo/redo', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const original = row();
    original.data.nodes = [{ id: 'portrait', type: 'slide', position: { x: 0, y: 0 }, style: { width: 480, height: 300 }, data: { kind: 'image', src: 'https://example.com/portrait.jpg', name: 'Retrato', color: '#fff', background: 'transparent', fontSize: 24 } }];
    render(<SlidesEditor row={original} userId="tester" onSave={onSave} onBack={vi.fn()} onUpload={vi.fn()} />);
    // Create a history entry before the original image has finished loading.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Adicionar conteúdo' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Adicionar texto' }));
    fireEvent.blur(await screen.findByLabelText('Texto do slide'));
    const image = screen.getByAltText('Retrato');
    Object.defineProperty(image, 'naturalWidth', { value: 1080 });
    Object.defineProperty(image, 'naturalHeight', { value: 1920 });
    fireEvent.load(image);
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agora' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const fitted = onSave.mock.lastCall[1].nodes[0];
    expect(fitted.width / fitted.height).toBeCloseTo(1080 / 1920);
    expect(fitted.data.naturalHeight).toBe(1920);
    fireEvent.click(screen.getByRole('button', { name: 'Refazer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agora' }));
    await waitFor(() => expect(onSave.mock.lastCall[1].nodes).toHaveLength(2));
    expect(onSave.mock.lastCall[1].nodes[0].style).toEqual(fitted.style);
  });

  it('arranges the full panel from the edit menu and restores positions with undo', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const original = row();
    original.data.nodes = [
      { id: 'a', type: 'slide', position: { x: -100, y: 40 }, style: { width: 200, height: 100 }, data: { kind: 'text', text: 'A', color: '#fff', background: 'transparent', fontSize: 24 } },
      { id: 'b', type: 'slide', position: { x: 500, y: 200 }, style: { width: 100, height: 200 }, data: { kind: 'text', text: 'B', color: '#fff', background: 'transparent', fontSize: 24 } },
    ];
    render(<SlidesEditor row={original} userId="tester" onSave={onSave} onBack={vi.fn()} onUpload={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Mais opções' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Centralizar na vertical' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agora' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [a, b] = onSave.mock.lastCall[1].nodes;
    expect(a.position.x + 100).toBe(b.position.x + 50);
    expect(b.position.y - a.position.y).toBe(148);
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agora' }));
    await waitFor(() => expect(onSave.mock.lastCall[1].nodes.map(n => n.position)).toEqual(original.data.nodes.map(n => n.position)));
  });

});
