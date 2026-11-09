import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { CheckSquare, Layers, Network, StickyNote } from "lucide-react";
import { SilverBrand } from "./SilverBrand";
import "./AuthLayout.css";

interface AuthLayoutProps {
  children: ReactNode;
}

const features = [
  { icon: CheckSquare, label: "Tarefas e rotina diária" },
  { icon: StickyNote, label: "Notas e checklists" },
  { icon: Network, label: "Mapas mentais e slides" },
  { icon: Layers, label: "Publicação e fluxos multi-contas" },
];

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <main className="auth-layout">
      <div className="silver-nebula" aria-hidden="true" />

      <section className="auth-story" aria-label="DISPARO">
        <div className="auth-story-topline">
          <div className="auth-logo">
            <Link to="/auth?welcome=1" aria-label="DISPARO · Voltar à tela inicial">
              <SilverBrand />
            </Link>
          </div>
          <span className="chip">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
            DISPARO
          </span>
        </div>

        <div className="auth-story-content">
          <h1>
            Mais clareza.
            <br />
            <span>Mais controle.</span>
          </h1>
          <p className="auth-story-description">
            Tarefas, notas, mapas mentais e publicação em redes sociais reunidos em um único espaço de trabalho.
          </p>

          <ul className="auth-feature-list" aria-label="Recursos principais">
            {features.map(({ icon: Icon, label }) => (
              <li key={label}>
                <span className="auth-feature-icon" aria-hidden="true">
                  <Icon className="h-4 w-4" />
                </span>
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="auth-story-footer">Menos ruído. Mais espaço para o que importa.</p>
      </section>

      <section className="auth-form-area" aria-label="Acesso à sua conta">
        <div className="auth-logo auth-mobile-logo">
          <Link to="/auth?welcome=1" aria-label="DISPARO · Voltar à tela inicial">
            <SilverBrand />
          </Link>
        </div>
        <div className="auth-card">{children}</div>
      </section>
    </main>
  );
}
