import { InstagramAnalytics } from "./InstagramAnalytics";
import "./hotfy-dashboard.css";

export default function AccountViews() {
  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Análise de conta</div>
          <h1 className="page-title">Visualizações</h1>
          <p className="page-subtitle">Acompanhe o desempenho dos vídeos das suas contas do Instagram.</p>
        </div>
      </header>
      <InstagramAnalytics />
    </>
  );
}
