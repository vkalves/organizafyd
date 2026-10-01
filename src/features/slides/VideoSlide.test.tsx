import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoSlide } from './VideoSlide';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('video loading and drag area', () => {
  it('loads the first frame and reserves a drag area outside the player controls', () => {
    render(<VideoSlide src="https://example.com/video.mp4" presenting={false} />);
    const player = screen.getByLabelText('Vídeo do slide');
    expect(player).toHaveAttribute('preload', 'auto');
    expect(player).toHaveClass('nodrag', 'nopan');
    expect(screen.getByTestId('video-drag-handle').closest('.nodrag')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando vídeo');
    Object.defineProperty(player, 'videoWidth', { value: 1920 });
    fireEvent.loadedData(player);
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('reports the video dimensions as soon as metadata is available', () => {
    const onDimensions = vi.fn();
    render(<VideoSlide src="https://example.com/portrait.mp4" presenting={false} onDimensions={onDimensions} />);
    const player = screen.getByLabelText('Vídeo do slide');
    Object.defineProperty(player, 'videoWidth', { value: 1080 });
    Object.defineProperty(player, 'videoHeight', { value: 1920 });
    fireEvent.loadedMetadata(player);
    expect(onDimensions).toHaveBeenCalledWith(1080, 1920);
  });
  it('explains unsupported codecs and provides a reload button', () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    render(<VideoSlide src="https://example.com/video.mp4" presenting={false} />);
    const player = screen.getByLabelText('Vídeo do slide');
    Object.defineProperty(player, 'error', { value: { code: 4 } });
    fireEvent.error(player);
    expect(screen.getByRole('status')).toHaveTextContent('H.264');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(load).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando vídeo');
  });
  it('detects files with duration but no decodable video track', () => {
    render(<VideoSlide src="https://example.com/video.mp4" presenting={false} />);
    fireEvent.loadedData(screen.getByLabelText('Vídeo do slide'));
    expect(screen.getByRole('status')).toHaveTextContent('não contém uma imagem de vídeo');
  });
  it('hides the drag handle during presentation without remounting the video', () => {
    const { rerender } = render(<VideoSlide src="https://example.com/video.mp4" presenting={false} />);
    const player = screen.getByLabelText('Vídeo do slide');
    rerender(<VideoSlide src="https://example.com/video.mp4" presenting />);
    expect(screen.queryByTestId('video-drag-handle')).toBeNull();
    expect(screen.getByLabelText('Vídeo do slide')).toBe(player);
  });
});
