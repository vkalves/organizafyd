import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { ArrowUpRight, BarChart3, Layers, ShieldCheck } from "lucide-react";
import { SilverBrand } from "./SilverBrand";
import "./AuthLayout.css";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-layout">
      <div className="auth-shell">
        <section className="auth-showcase" aria-label="Conheça o DISPARA">
          <div className="auth-showcase-grid" aria-hidden="true" />
          <div className="auth-showcase-topline">
            <Link to="/auth?welcome=1" aria-label="DISPARA · Tela inicial"><SilverBrand /></Link>
            <span>PUBLICAÇÃO & PERFORMANCE</span>
          </div>
          <div className="auth-emblem-stage" aria-hidden="true">
            <span className="auth-emblem-orbit auth-emblem-orbit-one" />
            <span className="auth-emblem-orbit auth-emblem-orbit-two" />
            <span className="auth-emblem-halo" />
            <img src="/branding/dispara-simbolo-cromo.svg" width="365" height="300" alt="" />
          </div>
          <div className="auth-showcase-copy">
            <p className="auth-showcase-kicker">SUA OPERAÇÃO, EM OUTRO NÍVEL</p>
            <h1>Menos limites.<br /><span>Mais resultados.</span></h1>
            <p>Conecte suas contas, publique com controle e acompanhe o que faz sua audiência crescer.</p>
            <div className="auth-showcase-features" aria-label="Recursos principais">
              <span><Layers size={14} aria-hidden="true" /> Publicação</span>
              <span><BarChart3 size={14} aria-hidden="true" /> Métricas</span>
              <span><ArrowUpRight size={14} aria-hidden="true" /> Performance</span>
            </div>
          </div>
          <div className="auth-showcase-footer"><span /> DA ESTRATÉGIA AO RESULTADO.</div>
        </section>
        <section className="auth-form-area" aria-label="Acesso à sua conta">
          <div className="auth-card">
            <Link className="auth-form-brand" to="/auth?welcome=1" aria-label="DISPARA · Tela inicial"><SilverBrand /></Link>
            {children}
            <p className="auth-security"><ShieldCheck size={13} aria-hidden="true" /> Seu espaço. Seu controle.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
