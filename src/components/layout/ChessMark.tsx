import { useEffect, useRef } from "react";
import "./chess-mark.css";
export function ChessMark({ animated = false, onReady }: { animated?: boolean; onReady?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current || typeof WebGLRenderingContext === "undefined") { onReady?.(); return; }
    let active = true;
    let dispose: (() => void) | undefined;
    // Keep Three.js off the initial application bundle. Icons mount only near the viewport.
    const canvas = ref.current;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void import("./chess-scene").then(({ mountChess }) => {
        if (!active) return;
        try { dispose = mountChess(canvas, animated); } catch { canvas.style.opacity = "0"; }
        onReady?.();
      }).catch(() => { if (active) onReady?.(); });
    });
    const startup = new MutationObserver(() => {
      if (!document.querySelector(".welcome-stage")) { startup.disconnect(); observer.observe(canvas); }
    });
    // Only the intro allocates a WebGL context while the presentation is open.
    if (!onReady && document.querySelector(".welcome-stage")) startup.observe(document.body, { childList: true, subtree: true });
    else observer.observe(canvas);
    return () => { active = false; startup.disconnect(); observer.disconnect(); dispose?.(); };
  }, [animated, onReady]);
  return <span className={`chess-perspective${animated ? " is-animated" : ""}`} aria-hidden="true">
    <img src="/branding/avanca-simbolo-claro.svg" alt="" width="106" height="154" className="chess-fallback" />
    <canvas ref={ref} className="chess-canvas" />
  </span>;
}
