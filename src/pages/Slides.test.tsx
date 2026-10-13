import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'tester' } }) }));
vi.mock('@/hooks/useSupabaseCrud', () => ({ useSupabaseCrud: () => ({ data: [], loading: false, create: mocks.create, update: vi.fn(), remove: vi.fn() }) }));
vi.mock('@/features/slides/SlidesEditor', () => ({ SlidesEditor: ({ row, fitOnOpen }: { row: { title: string }; fitOnOpen: boolean }) => <div>Editor: {row.title} {fitOnOpen ? 'enquadrado' : ''}</div> }));
import Slides from './Slides';
const contents = JSON.stringify({ title: 'Importado', data: { kind: 'slides', version: 1, nodes: [{ position: { x: 0, y: 0 }, style: { width: 300, height: 100 }, data: { kind: 'text', text: 'Teste' } }] } });
function file(text: string) { const f = new File([text], 'slide.json'); Object.defineProperty(f, 'text', { value: async () => text }); return f; }
afterEach(cleanup);
beforeEach(() => mocks.create.mockReset());
describe('importing slides from the library screen', () => {
  it('creates a new record and opens it framed for editing', async () => {
    mocks.create.mockImplementation(async input => ({ ...input, id: 'new', updated_at: new Date().toISOString() }));
    render(<Slides />);
    fireEvent.change(screen.getByLabelText('Arquivo de slide'), { target: { files: [file(contents)] } });
    expect(await screen.findByText('Editor: Importado enquadrado')).toBeVisible();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0].data.nodes[0].data.text).toBe('Teste');
  });
  it('shows validation errors without creating an empty presentation', async () => {
    render(<Slides />);
    fireEvent.drop(screen.getByRole('region', { name: 'Importar slide' }), { dataTransfer: { files: [file('{')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('JSON válido');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('keeps the import screen available when saving fails', async () => {
    mocks.create.mockResolvedValue(null);
    render(<Slides />);
    fireEvent.change(screen.getByLabelText('Arquivo de slide'), { target: { files: [file(contents)] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível salvar'));
    expect(screen.getByRole('button', { name: 'Escolher arquivo' })).toBeEnabled();
  });
});
