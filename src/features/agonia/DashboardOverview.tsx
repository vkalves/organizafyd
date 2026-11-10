import { ArrowRight, CalendarClock, Check, Film, Layers, TrendingUp, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import type { Post } from "@/features/instagram-publisher/model";
import { healthLabels, type AccountAlert } from "@/features/instagram-publisher/monitor";
import type { AnalyticsReport } from "@/features/instagram-publisher/useInstagramAnalytics";

export type DashboardPeriod = "today" | "yesterday" | "7d";
const number = new Intl.NumberFormat("pt-BR");
const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function dashboardWindow(period: DashboardPeriod, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  start.setDate(start.getDate() - (period === "7d" ? 6 : period === "yesterday" ? 1 : 0));
  if (period !== "yesterday") end.setDate(end.getDate() + 1);
  return (value?: string | null) => {
    const time = value ? Date.parse(value) : NaN;
    return time >= +start && time < +end;
  };
}

export function DashboardViewsChart({ report, accountIds }: { report?: AnalyticsReport; accountIds: string[] }) {
  const groups = new Map<number, number>();
  const includes = dashboardWindow("7d");
  const selectedAccounts = new Set(accountIds);
  const seen = new Set<string>();
  for (const account of report?.accounts ?? []) {
    if (!selectedAccounts.has(account.account_id)) continue;
    for (const video of account.videos) {
      if (video.views === null || !includes(video.timestamp) || seen.has(video.id)) continue;
      seen.add(video.id);
      const date = new Date(video.timestamp);
      const day = +new Date(date.getFullYear(), date.getMonth(), date.getDate());
      groups.set(day, (groups.get(day) ?? 0) + video.views);
    }
  }
  const days = [...groups].sort(([a], [b]) => a - b);
  const max = Math.max(1, ...days.map(([, views]) => views));
  const points = days.map(([, views], index) => [days.length === 1 ? 180 : 16 + 328 * index / (days.length - 1), 116 - views / max * 94]);
  const line = points.map(([x, y]) => `${x},${y}`).join(" ");

  return (
    <figure className="dash-views-chart">
      <figcaption><strong>Visualizações por data de publicação</strong><small>Totais dos vídeos consultados, publicados nos últimos 7 dias.</small></figcaption>
      {points.length ? <>
        <svg viewBox="0 0 360 130" aria-hidden="true">
          <defs><linearGradient id="avanca-chart-fill" x2="0" y2="1"><stop stopColor="white" stopOpacity=".25" /><stop offset="1" stopColor="white" stopOpacity="0" /></linearGradient></defs>
          {[22, 53, 84, 116].map(y => <path key={y} d={`M16 ${y}H344`} stroke="currentColor" strokeOpacity=".19" strokeDasharray="2 4" />)}
          {points.length > 1 && <polygon points={`${points[0][0]},116 ${line} ${points.at(-1)![0]},116`} fill="url(#avanca-chart-fill)" />}
          <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          {points.map(([x, y], i) => <circle key={days[i][0]} cx={x} cy={y} r="3" fill="currentColor"><title>{shortDate.format(days[i][0])}: {number.format(days[i][1])} visualizações</title></circle>)}
        </svg>
        <ol className="dash-chart-labels">{days.map(([day, views]) => <li key={day}><span>{shortDate.format(day)}</span><strong>{number.format(views)}</strong></li>)}</ol>
      </> : <div className="dash-empty">Sem visualizações disponíveis para vídeos publicados nesse intervalo.</div>}
    </figure>
  );
}

export function DashboardSchedule({ posts, accounts, pending, error }: { posts: Post[]; accounts: Map<string, string>; pending: boolean; error: boolean }) {
  return (
    <section className="panel dash-schedule">
      <div className="dash-widget-head"><h2><CalendarClock /> Próximos agendamentos</h2><Link to="/dispara/scheduled">Ver todos <ArrowRight /></Link></div>
      {posts.length ? <ul className="dash-entries">{posts.slice(0, 3).map(post => (
        <li key={post.id}><span className="dash-entry-icon"><Film /></span><div><strong>{post.caption.trim() || `${post.format} sem legenda`}</strong><small>{post.scheduled_at && Number.isFinite(Date.parse(post.scheduled_at)) ? dateTime.format(new Date(post.scheduled_at)) : "Horário indisponível"} · {accounts.has(post.account_id) ? `@${accounts.get(post.account_id)}` : post.format}</small></div></li>
      ))}</ul> : <p className="dash-empty" role="status">{pending ? "Carregando agendamentos…" : error ? "Não foi possível carregar os agendamentos." : "Nenhuma publicação na fila."}</p>}
    </section>
  );
}

export function DashboardOverview({ posts, alerts, period, periodLabel, pending, error }: { posts: Post[]; alerts: AccountAlert[]; period: DashboardPeriod; periodLabel: string; pending: boolean; error: boolean }) {
  const includes = dashboardWindow(period);
  const created = posts.filter(post => includes(post.created_at)).length;
  const queued = posts.filter(post => (post.status === "scheduled" || post.status === "processing") && includes(post.scheduled_at)).length;
  const published = posts.filter(post => post.status === "published" && includes(post.published_at || post.created_at));
  const recent = [
    ...alerts.map(alert => ({ id: `alert-${alert.id}`, date: alert.created_at, title: healthLabels[alert.state], detail: "Alerta de conta", to: "/dispara/alertas" })),
    ...posts.filter(post => post.status === "published" || post.status === "failed").map(post => ({
      id: `post-${post.id}`, date: post.published_at || post.updated_at || post.created_at,
      title: post.status === "published" ? `${post.format} publicado` : `Falha ao publicar ${post.format}`,
      detail: post.caption.trim() || "Sem legenda", to: "/dispara/reels",
    })),
  ].filter(item => Number.isFinite(Date.parse(item.date))).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 3);
  const count = (value: number) => pending || error ? "—" : number.format(value);

  return (
    <div className="dash-overview">
      <section className="panel">
        <div className="dash-widget-head"><h2><TrendingUp /> Resumo de desempenho</h2></div>
        <p className="panel-copy">Publicações concluídas · {periodLabel}</p>
        <dl className="dash-counts">
          <div><dt>Reels</dt><dd>{count(published.filter(post => post.format === "Reel").length)}</dd></div>
          <div><dt>Stories</dt><dd>{count(published.filter(post => post.format === "Story").length)}</dd></div>
          <div><dt>Total</dt><dd>{count(published.length)}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <div className="dash-widget-head"><h2><Layers /> Fluxo de publicação</h2></div>
        <p className="panel-copy">Registros por etapa · {periodLabel}</p>
        <ol className="dash-counts dash-steps">
          {([["Criados", created], ["Na fila", queued], ["Publicados", published.length]] as const).map(([label, value]) => (
            <li key={label}><span className="dash-step-marker">{value > 0 && !pending && !error && <Check />}</span><span>{label}</span><strong>{count(value)}</strong></li>
          ))}
        </ol>
      </section>
      <section className="panel">
        <div className="dash-widget-head"><h2><Zap /> Atividade recente</h2><Link to="/dispara/reels">Ver histórico <ArrowRight /></Link></div>
        {recent.length ? <ul className="dash-entries">{recent.map(item => (
          <li key={item.id}><Link to={item.to}><span className="dash-entry-icon"><Zap /></span><div><strong>{item.title}</strong><small>{item.detail} · {dateTime.format(new Date(item.date))}</small></div></Link></li>
        ))}</ul> : <p className="dash-empty">{pending ? "Carregando atividade…" : error ? "Não foi possível carregar as publicações." : "Nenhuma atividade recente."}</p>}
      </section>
    </div>
  );
}
