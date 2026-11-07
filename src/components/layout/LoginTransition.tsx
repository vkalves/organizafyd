import { useEffect } from "react";
import agoniaMask from "@/assets/agonia-mask.webp";
import "./login-transition.css";

const DURATION_MS = 3700;
const REDUCED_MS = 1600;

/** Animação de boas-vindas do Agonia Pro adaptada ao tema Silver do Organizafy. */
export function LoginTransition({ name, onDone }: { name: string; onDone: () => void }) {
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(onDone, reduced ? REDUCED_MS : DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="welcome-intro" role="status" aria-live="polite" aria-label={`Seja Bem-vindo, ${name}`}>
      <div className="welcome-mask-stage" aria-hidden="true">
        <div className="welcome-orbit welcome-orbit-one" />
        <div className="welcome-orbit welcome-orbit-two" />
        <img src={agoniaMask} alt="" width={320} height={320} />
      </div>
      <div className="welcome-message">
        <span>Seja Bem-vindo</span>
        <strong>{name}</strong>
      </div>
    </div>
  );
}
