import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { ArrowUpRight, Check, Circle, LayoutGrid } from "lucide-react";
import { SilverBrand } from "./SilverBrand";
import { SilverNebula } from "./SilverNebula";
import agoniaMask from "@/assets/agonia-mask.webp";
import "./AuthLayout.css";

interface AuthLayoutProps {
  children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <main className="auth-layout">
      <SilverNebula />
      <section className="auth-story" aria-label="Organizafy">
        <div className="auth-story-topline">
          <div className="auth-logo"><Link to="/auth?welcome=1" aria-label="Organizafy · Voltar à tela inicial"><SilverBrand /></Link></div>
          <span className="auth-showcase-badge"><i /> SISTEMA ATIVO · AGONIA PRO</span>
        </div>

        <div className="auth-story-content">
          <div className="auth-showcase-stage" aria-hidden="true">
            <div className="auth-mask-orbit auth-mask-orbit-one" />
            <div className="auth-mask-orbit auth-mask-orbit-two" />
            <img src={agoniaMask} alt="" className="auth-mask-image" width={220} height={220} />
          </div>

          <p className="auth-eyebrow"><span /> SEU DIA E SUA OPERAÇÃO EM ORDEM</p>
          <h1>Mais clareza.<br /><span>Mais controle.</span></h1>
          <p className="auth-story-description">Suas tarefas, notas, fluxos e o painel Agonia Pro.<br />Tudo conectado em um só lugar.</p>

          <div className="auth-preview" aria-hidden="true">
            <div className="auth-preview-bar"><LayoutGrid size={14} /><span>CENTRAL DE ORGANIZAÇÃO + AGONIA PRO</span><Circle size={5} /><Circle size={5} /><Circle size={5} /></div>
            <div className="auth-preview-body">
              <div className="auth-preview-heading"><span>Uma visão do que importa.</span><ArrowUpRight size={16} /></div>
              <div className="auth-preview-tags"><span><Check size={12} /> Modelo Antigo</span><span><Check size={12} /> Modo Agonia Pro</span><span><Check size={12} /> Multi-contas</span></div>
              <svg viewBox="0 0 480 130" role="presentation" className="auth-preview-chart" preserveAspectRatio="none">
                <defs><linearGradient id="auth-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#dedbd6" stopOpacity="0.28" /><stop offset="100%" stopColor="#dedbd6" stopOpacity="0" /></linearGradient></defs>
                <path d="M0 38H480 M0 78H480 M0 118H480" stroke="#ffffff" strokeOpacity="0.06" fill="none" />
                <path d="M0 108 C45 108 57 66 111 65 S191 106 249 88 S315 21 362 27 S435 60 480 13 L480 130 L0 130Z" fill="url(#auth-chart-fill)" />
                <path d="M0 108 C45 108 57 66 111 65 S191 106 249 88 S315 21 362 27 S435 60 480 13" stroke="#dedbd6" strokeWidth="2" fill="none" />
              </svg>
            </div>
          </div>
        </div>
        <p className="auth-story-footer">MENOS RUÍDO. MAIS ESPAÇO PARA O QUE IMPORTA.</p>
      </section>

      <section className="auth-form-area" aria-label="Acesso à sua conta">
        <div className="auth-logo auth-mobile-logo"><Link to="/auth?welcome=1" aria-label="Organizafy · Voltar à tela inicial"><SilverBrand /></Link></div>
        <div className="auth-card">{children}</div>
        <p className="auth-form-footer">Seu espaço para uma rotina mais leve.</p>
      </section>
    </main>
  );
}
