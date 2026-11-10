import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { BarChart3, Layers, Users, X } from "lucide-react";
import "./welcome-animation.css";

/** One presentation per page load, except on the dedicated authorization route. */
export function WelcomeAnimation() {
  const [visible, setVisible] = useState(() => window.location.pathname.replace(/\/+$/, "") !== "/instagram/conectar");

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), 1800);
    return () => window.clearTimeout(timer);
  }, [visible]);

  return (
    <Dialog.Root open={visible} onOpenChange={setVisible}>
      <Dialog.Portal>
        <Dialog.Content className="welcome-stage">
          <div className="welcome-stage-grid" aria-hidden="true" />
          <header className="welcome-stage-header">
            <span className="welcome-stage-signature">
              <img src="/branding/favicon.svg" width="32" height="32" alt="" />
              AVANÇA <span>ESTÚDIO DE PUBLICAÇÃO</span>
            </span>
            <Dialog.Close className="welcome-stage-skip" aria-label="Pular apresentação">
              <span>Pular</span><X size={18} aria-hidden="true" />
            </Dialog.Close>
          </header>

          <div className="welcome-stage-content">
            <div className="welcome-stage-emblem" aria-hidden="true">
              <img src="/branding/avanca-simbolo-claro.svg" width="106" height="154" alt="" />
            </div>
            <p className="welcome-stage-kicker">SUA PRÓXIMA FASE COMEÇA AGORA</p>
            <Dialog.Title className="welcome-stage-title">
              <span>Bem-vindo à</span> Avança
            </Dialog.Title>
            <Dialog.Description className="welcome-stage-description">
              Mais controle. Mais alcance. Mais resultados.
            </Dialog.Description>
            <div className="welcome-stage-features" aria-label="Recursos da plataforma">
              <span><Users size={16} aria-hidden="true" /> Suas contas</span>
              <span><Layers size={16} aria-hidden="true" /> Seus conteúdos</span>
              <span><BarChart3 size={16} aria-hidden="true" /> Seus resultados</span>
            </div>
          </div>

          <footer className="welcome-stage-footer">
            <span>DA ESTRATÉGIA AO RESULTADO.</span>
            <span>A apresentação fecha automaticamente.</span>
          </footer>
          <span className="welcome-stage-progress" aria-hidden="true" />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
