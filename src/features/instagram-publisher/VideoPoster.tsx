import { useEffect, useState } from "react";
import { Film } from "lucide-react";
import { videoPoster } from "./video-poster";
export function VideoPoster({ src, visible, label }: { src: string; visible: boolean; label: string }) {
  const [poster, setPoster] = useState<{ src: string; url: string } | null>(null);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    const controller = new AbortController();
    void videoPoster(src, controller.signal).then(url => { if (active) setPoster({ src, url }); }).catch(() => {});
    return () => { active = false; controller.abort(); };
  }, [src, visible]);
  return poster?.src === src ? <img src={poster.url} alt={label} className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-muted-foreground" aria-label={label}><Film size={18} /></span>;
}
