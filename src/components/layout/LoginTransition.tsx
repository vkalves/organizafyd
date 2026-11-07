import { useEffect } from "react";
import { SilverBrand } from "./SilverBrand";
import "./login-transition.css";

const DURATION_MS = 2400;
const REDUCED_MS = 700;

/** Tela de transição exibida após um login bem-sucedido. */
export function LoginTransition({ name, onDone }: { name: string; onDone: () => void }) {
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(onDone, reduced ? REDUCED_MS : DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="login-transition" role="status" aria-live="polite" aria-label={`Entrando como ${name}`}>
      <div className="login-transition-glow" aria-hidden="true" />
      <div className="login-transition-center">
        <div className="login-transition-ring">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle className="login-transition-track" cx="60" cy="60" r="54" />
            <circle className="login-transition-arc" cx="60" cy="60" r="54" pathLength={100} />
          </svg>
          <SilverBrand compact />
        </div>
        <p className="login-transition-hello">Bem-vindo de volta,</p>
        <h2 className="login-transition-name">{name}</h2>
        <p className="login-transition-sub">Preparando seu espaço…</p>
      </div>
      <span className="login-transition-bar" aria-hidden="true" />
    </div>
  );
}
