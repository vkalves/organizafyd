import { useEffect, useState } from "react";
import { Film } from "lucide-react";
import { cachedVideoPoster, videoPoster } from "./video-poster";
export function VideoPoster({ src, visible, label, cacheKey = src }: { src: string; visible: boolean; label: string; cacheKey?: string }) {
  const [poster, setPoster] = useState<{ key: string; url: string } | null>(() => { const url = cachedVideoPoster(cacheKey); return url ? { key: cacheKey, url } : null; });
  useEffect(() => {
    if (!visible) return;
    let active = true;
    const controller = new AbortController();
    void videoPoster(src, controller.signal, cacheKey).then(url => { if (active) setPoster({ key: cacheKey, url }); }).catch(() => {});
    return () => { active = false; controller.abort(); };
  }, [src, visible, cacheKey]);
  return poster?.key === cacheKey ? <img src={poster.url} alt={label} className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-muted-foreground" aria-label={label}><Film size={18} /></span>;
}
