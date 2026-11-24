import { InstagramAnalytics } from "./InstagramAnalytics";
import "./hotfy-dashboard.css";

export default function AccountViews() {
  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">Análise de conta</div>
          <h1 className="page-title">Visualizações</h1>
          <p className="page-subtitle">Acompanhe visualizações, curtidas e seguidores das suas contas do Instagram organizadas por pastas.</p>
        </div>
      </header>
      <InstagramAnalytics />
    </>
  );
}
