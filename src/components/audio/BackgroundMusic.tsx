import { useEffect, useRef, useState } from "react";
import { Music2, Pause, Play, Volume1, Volume2, VolumeX } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import "./background-music.css";

const defaultVolume = 0.08;
function savedVolume() {
  try {
    const stored = localStorage.getItem("organizafy-music-volume");
    const value = stored === null ? defaultVolume : Number(stored);
    return Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : defaultVolume;
  } catch {
    return defaultVolume;
  }
}
function savedEnabled() {
  try {
    return localStorage.getItem("organizafy-music-enabled") !== "off";
  } catch {
    return true;
  }
}

/** Mounted above the routes so navigation and login never recreate the audio. */
export function BackgroundMusic({
  source = import.meta.env.VITE_BACKGROUND_MUSIC_URL ||
    "/audio/hotfy-background.m4a",
}: {
  source?: string;
}) {
  const { user } = useAuth();
  const audio = useRef<HTMLAudioElement>(null);
  const previousUser = useRef(user?.id);
  const lastVolume = useRef(defaultVolume);
  const [volume, setVolume] = useState(savedVolume);
  const [enabled, setEnabled] = useState(savedEnabled);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
    if (volume > 0) lastVolume.current = volume;
    try {
      localStorage.setItem("organizafy-music-volume", String(volume));
    } catch {
      /* Preferences are optional. */
    }
  }, [volume]);
  useEffect(() => {
    try {
      localStorage.setItem("organizafy-music-enabled", enabled ? "on" : "off");
    } catch {
      /* Preferences are optional. */
    }
  }, [enabled]);
  useEffect(() => {
    if (user?.id && previousUser.current !== user.id) {
      setVolume((current) => Math.min(current, defaultVolume));
    }
    previousUser.current = user?.id;
  }, [user?.id]);
  useEffect(() => {
    setFailed(false);
    const element = audio.current;
    if (!element || !source || !enabled) {
      element?.pause();
      return;
    }
    let active = true;
    const start = () => {
      if (!active) return;
      void element.play().catch(() => {
        /* Wait for the next browser-authorized gesture. */
      });
    };
    start();
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", start);
    return () => {
      active = false;
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
  }, [source, enabled]);

  function toggle() {
    if (playing) {
      setEnabled(false);
      audio.current?.pause();
    } else {
      setEnabled(true);
      setFailed(false);
      void audio.current?.play().catch(() => setPlaying(false));
    }
  }
  const percent = Math.round(volume * 100);
  return (
    <aside className="background-music" aria-label="Player de música de fundo">
      <audio
        ref={audio}
        src={source || undefined}
        loop
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          setFailed(true);
          setPlaying(false);
        }}
      />
      <div className="background-music-title">
        <Music2 size={14} aria-hidden="true" />
        <span>
          Música de fundo
          <small>
            {!source
              ? "Aguardando a faixa da HOTfy"
              : failed
                ? "Não foi possível carregar a música"
                : playing
                  ? percent === 0
                    ? "Silenciada"
                    : percent <= 10
                      ? "Tocando suavemente"
                      : "Reproduzindo"
                  : "Pausada · toque para ouvir"}
          </small>
        </span>
      </div>
      <div className="background-music-controls">
        <button
          type="button"
          onClick={toggle}
          disabled={!source}
          aria-label={playing ? "Pausar música" : "Reproduzir música"}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          type="button"
          disabled={!source}
          aria-label={
            volume === 0 ? "Ativar volume da música" : "Silenciar música"
          }
          onClick={() =>
            setVolume((current) => (current === 0 ? lastVolume.current : 0))
          }
        >
          {volume === 0 ? (
            <VolumeX size={16} />
          ) : volume < 0.3 ? (
            <Volume1 size={16} />
          ) : (
            <Volume2 size={16} />
          )}
        </button>
        <input
          type="range"
          aria-label="Volume da música de fundo"
          min="0"
          max="100"
          step="1"
          value={percent}
          onChange={(event) => setVolume(Number(event.target.value) / 100)}
        />
        <output aria-live="off">{percent}%</output>
      </div>
    </aside>
  );
}
