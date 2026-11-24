import { InstagramAnalytics } from "./InstagramAnalytics";
import "./hotfy-dashboard.css";

export default function AccountViews() {
  return (
    <div className="space-y-5">
      <header className="topbar">
        <div>
          <div className="eyebrow">Instagram</div>
          <h1 className="page-title">Métricas</h1>
          <p className="page-subtitle">
            Visualizações, curtidas e seguidores em tempo real por pasta e conta.
          </p>
        </div>
      </header>
      <InstagramAnalytics />
    </div>
  );
}
