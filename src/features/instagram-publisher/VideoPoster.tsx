import { useEffect, useState } from "react";
import { Film } from "lucide-react";
import { cachedVideoPoster, videoPoster } from "./video-poster";

export function VideoPoster({
  src,
  visible,
  label,
  cacheKey = src,
}: {
  src: string;
  visible: boolean;
  label: string;
  cacheKey?: string;
}) {
  const [poster, setPoster] = useState<{ key: string; url: string } | null>(() => {
    const url = cachedVideoPoster(cacheKey);
    return url ? { key: cacheKey, url } : null;
  });
  const [fallbackKey, setFallbackKey] = useState<string | null>(null);
  const [videoFailedKey, setVideoFailedKey] = useState<string | null>(null);

  useEffect(() => {
    const cached = cachedVideoPoster(cacheKey);
    if (cached) {
      setPoster({ key: cacheKey, url: cached });
      return;
    }
    if (!visible) return;
    let active = true;
    const controller = new AbortController();
    void videoPoster(src, controller.signal, cacheKey)
      .then((url) => {
        if (active) setPoster({ key: cacheKey, url });
      })
      .catch(() => {
        if (active && !controller.signal.aborted) {
          setFallbackKey(cacheKey);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [src, visible, cacheKey]);

  if (poster?.key === cacheKey) {
    return <img src={poster.url} alt={label} className="h-full w-full object-cover" />;
  }
  if (visible && fallbackKey === cacheKey && videoFailedKey !== cacheKey) {
    return (
      <video
        src={src}
        muted
        playsInline
        preload="auto"
        aria-label={label}
        onLoadedData={(e) => {
          const v = e.currentTarget;
          if (v.currentTime === 0 && v.duration > 0.15) {
            try {
              v.currentTime = 0.15;
            } catch {
              /* ignore seek error */
            }
          }
        }}
        onError={() => setVideoFailedKey(cacheKey)}
        className="pointer-events-none h-full w-full object-cover"
      />
    );
  }
  return (
    <span
      className="flex h-full w-full items-center justify-center text-muted-foreground"
      aria-label={label}
    >
      <Film size={18} />
    </span>
  );
}
