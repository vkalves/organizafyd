import { useEffect, useRef, useState } from 'react';
import { GripVertical, RefreshCw } from 'lucide-react';

type Props = { src?: string; name?: string; presenting: boolean };
function videoErrorMessage(code?: number) {
  if (code === 2) return 'Não foi possível baixar o vídeo. Confira sua conexão e tente novamente.';
  if (code === 3 || code === 4) return 'O navegador não conseguiu reproduzir este arquivo. Use MP4 com vídeo H.264 e áudio AAC.';
  return 'Não foi possível carregar o vídeo. Tente novamente ou adicione outro arquivo.';
}

export function VideoSlide({ src, name, presenting }: Props) {
  const player = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'slow'>('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setState('loading'); setError('');
    const timer = window.setTimeout(() => setState(current => current === 'loading' ? 'slow' : current), 20000);
    return () => clearTimeout(timer);
  }, [src, attempt]);
  const retry = () => { setAttempt(a => a + 1); player.current?.load(); };
  return <div className="slide-video">
    {!presenting && <div className="slide-video-handle" title="Arraste esta barra com a ferramenta de seleção para mover o vídeo" data-testid="video-drag-handle"><GripVertical aria-hidden="true" /><span>Arraste para mover</span></div>}
    <div className="slide-video-frame">
      <video ref={player} className="nodrag nopan nowheel" src={src} controls playsInline preload="auto" aria-label={name || 'Vídeo do slide'}
        onLoadedData={e => {
          if (e.currentTarget.videoWidth > 0) setState('ready');
          else { setError('Este arquivo não contém uma imagem de vídeo que o navegador consiga reproduzir. Use MP4 com vídeo H.264 e áudio AAC.'); setState('error'); }
        }}
        onPlaying={() => { if (player.current?.videoWidth) setState('ready'); }}
        onError={e => { setError(videoErrorMessage(e.currentTarget.error?.code)); setState('error'); }} />
      {state === 'loading' && <div role="status" className="slide-video-loading">Carregando vídeo…</div>}
      {(state === 'error' || state === 'slow') && <div className="slide-video-message nodrag nopan nowheel" role="status">
        <p>{state === 'slow' ? 'O vídeo está demorando para abrir. Tente reproduzir ou carregar novamente.' : error}</p>
        <button type="button" onClick={retry}><RefreshCw aria-hidden="true" />Tentar novamente</button>
      </div>}
    </div>
  </div>;
}
