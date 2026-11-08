import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Instagram } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { publishedToday, type InstagramView } from "./HotfyDashboard";
import { listAccounts, listPosts } from "./api";
import { useInstagramMonitor } from "./InstagramAlerts";
import "./hotfy-dashboard.css";

export function InstagramOverview() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const monitor = useInstagramMonitor();

  const accounts = useQuery({
    queryKey: ["instagram-publisher-accounts", user?.id],
    queryFn: () => listAccounts(user!.id),
    enabled: !!user,
  });

  const posts = useQuery({
    queryKey: ["instagram-publisher", user?.id],
    queryFn: () => listPosts(user!.id),
    enabled: !!user,
    refetchInterval: 30000,
  });

  function go(view: InstagramView) {
    navigate(`/instagram?view=${view}`);
  }

  const loading = accounts.isLoading || posts.isLoading;
  const failed = accounts.isError || posts.isError;
  const postList = posts.data ?? [];
  const pendingCount = postList.filter((p) => ["scheduled", "processing"].includes(p.status) && p.format === "Reel").length;
  const todayCount = postList.filter((p) => publishedToday(p)).length;
  const alertAccounts = new Set(
    (monitor.data?.alerts ?? []).filter((a) => !a.resolved_at).map((a) => a.account_id),
  ).size;

  const stats = [
    ["Contas conectadas", accounts.data?.length ?? 0, "perfis ativos", "accounts"],
    ["Reels agendados", pendingCount, "na fila", "queue"],
    ["Publicados hoje", todayCount, "confirmados", "queue"],
    ["Contas com alerta", alertAccounts, "atenção", "alerts"],
  ] as const;

  return (
    <section aria-label="Visão geral do Instagram" className="panel overflow-hidden">
      <div className="panel-head pb-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
            <Instagram className="h-4 w-4" />
          </span>
          <div>
            <h2 className="section-title">Instagram</h2>
            <p className="section-subtitle">Resumo rápido das contas e fila de publicação</p>
          </div>
        </div>
        <button type="button" className="panel-link" onClick={() => go("flows")}>
          Abrir Instagram <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 border-t border-border lg:grid-cols-4">
        {stats.map(([title, value, detail, target], idx) => (
          <button
            key={title}
            type="button"
            onClick={() => go(target)}
            className={`flex flex-col gap-1 p-4 text-left transition-colors hover:bg-card-hover sm:px-5 ${
              idx % 2 === 1 ? "border-l border-border" : ""
            } ${idx >= 2 ? "border-t border-border lg:border-t-0" : ""} ${
              idx >= 2 ? "lg:border-l lg:border-border" : ""
            }`}
          >
            <span className="text-xs text-muted-foreground">{title}</span>
            <strong className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
              {loading || failed || (target === "alerts" && (!monitor.data || monitor.isError))
                ? "—"
                : value}
            </strong>
            <span className="text-xs text-muted-foreground">{detail}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
