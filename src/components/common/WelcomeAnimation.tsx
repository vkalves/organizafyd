import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import "./welcome-animation.css";

/** Mounted above the routes so navigating between modules does not replay it. */
export function WelcomeAnimation() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <aside className="welcome-animation" aria-label="Boas-vindas">
      <span className="welcome-animation-icon" aria-hidden="true"><Sparkles size={22} /></span>
      <div role="status">
        <strong>Bem-vindo à Organizafy!</strong>
        <p>Seu próximo resultado começa aqui.</p>
      </div>
      <button type="button" onClick={() => setVisible(false)} aria-label="Fechar boas-vindas">
        <X size={18} aria-hidden="true" />
      </button>
      <span className="welcome-animation-progress" aria-hidden="true" />
    </aside>
  );
}
