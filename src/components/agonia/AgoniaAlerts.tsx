import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCheck,
  CheckCircle2,
  ExternalLink,
  Instagram,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConnectAccount } from "@/features/instagram-publisher/ConnectAccount";
import {
  healthDetails,
  healthLabels,
  monitorRequest,
  type AccountAlert,
  type HealthState,
} from "@/features/instagram-publisher/monitor";
import { useInstagramMonitor } from "@/features/instagram-publisher/InstagramAlerts";
import type { Connection } from "@/features/instagram-publisher/api";

type TabFilter = "pending" | "all" | "resolved" | "matrix";

export function AgoniaAlerts({
  accounts,
  connections,
  onRefresh,
}: {
  accounts: { id: string; username: string }[];
  connections: Connection[];
  onRefresh: () => Promise<unknown>;
}) {
  const monitor = useInstagramMonitor();
  const [readingId, setReadingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [tab, setTab] = useState<TabFilter>("pending");

  const alerts = useMemo(
    () => monitor.data?.alerts ?? [],
    [monitor.data?.alerts],
  );
  const healthList = useMemo(
    () => monitor.data?.health ?? [],
    [monitor.data?.health],
  );

  const activeAlerts = useMemo(
    () => alerts.filter((a) => !a.resolved_at),
    [alerts],
  );
  const unreadAlerts = useMemo(
    () => alerts.filter((a) => !a.read_at && !a.resolved_at),
    [alerts],
  );
  const resolvedAlerts = useMemo(
    () => alerts.filter((a) => !!a.resolved_at),
    [alerts],
  );

  const accountMap = useMemo(
    () =>
      new Map(
        accounts.map((a) => [a.id, a.username.replace(/^@/, "")]),
      ),
    [accounts],
  );

  const healthMap = useMemo(
    () => new Map(healthList.map((h) => [h.account_id, h])),
    [healthList],
  );

  const degradedAccounts = useMemo(() => {
    return accounts.filter((a) => {
      const h = healthMap.get(a.id);
      const c = connections.find((conn) => conn.account_id === a.id);
      return (
        (h && h.state !== "healthy" && h.state !== "unknown") ||
        c?.reconnect_required
      );
    });
  }, [accounts, healthMap, connections]);

  async function handleMarkRead(id: string) {
    setReadingId(id);
    try {
      await monitorRequest("read", id);
      await monitor.refetch();
      toast.success("Alerta marcado como lido.");
    } catch {
      toast.error("Não foi possível marcar o alerta.");
    } finally {
      setReadingId(null);
    }
  }

  async function handleMarkAllRead() {
    const unread = alerts.filter((a) => !a.read_at);
    if (!unread.length) {
      toast.info("Não há alertas não lidos.");
      return;
    }
    setMarkingAll(true);
    try {
      await Promise.allSettled(
        unread.map((alert) => monitorRequest("read", alert.id)),
      );
      await monitor.refetch();
      toast.success(`${unread.length} alerta(s) marcado(s) como lido(s).`);
    } catch {
      toast.error("Erro ao marcar todos os alertas.");
    } finally {
      setMarkingAll(false);
    }
  }

  async function handleRefreshDiagnostic() {
    try {
      await Promise.all([monitor.refetch(), onRefresh()]);
      toast.success("Diagnóstico das contas atualizado com sucesso.");
    } catch {
      toast.error("Não foi possível atualizar o diagnóstico.");
    }
  }

  const displayedAlerts = useMemo(() => {
    switch (tab) {
      case "pending":
        return activeAlerts;
      case "resolved":
        return resolvedAlerts;
      case "all":
      default:
        return alerts;
    }
  }, [tab, activeAlerts, resolvedAlerts, alerts]);

  function renderStateBadge(state: HealthState, isResolved?: boolean) {
    if (isResolved) {
      return (
        <span className="badge badge-green inline-flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> Resolvido
        </span>
      );
    }
    switch (state) {
      case "reconnect":
      case "permissions":
        return (
          <span className="badge badge-red inline-flex items-center gap-1">
            <ShieldAlert className="h-3 w-3" /> Reconexão Necessária
          </span>
        );
      case "unavailable":
        return (
          <span className="badge badge-yellow inline-flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Perfil Inacessível
          </span>
        );
      case "temporary":
        return (
          <span className="badge badge-yellow inline-flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Falha Temporária
          </span>
        );
      case "healthy":
        return (
          <span className="badge badge-green inline-flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" /> Conexão Ativa
          </span>
        );
      default:
        return (
          <span className="badge badge-gray inline-flex items-center gap-1">
            Aguardando verificação
          </span>
        );
    }
  }

  return (
    <div className="agonia-alerts-view space-y-6">
      {/* Top Header */}
      <header className="topbar">
        <div>
          <div className="eyebrow">Diagnóstico em tempo real · Instagram</div>
          <h1 className="page-title">Alertas e Saúde das Contas</h1>
          <p className="page-subtitle">
            Monitore o status da API da Meta para cada perfil conectado. Detecte
            tokens expirados, limites de postagens ou restrições e resolva com
            1 clique.
          </p>
        </div>
        <div className="action-row">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={monitor.isLoading || markingAll}
            onClick={handleRefreshDiagnostic}
            className="button button-secondary"
          >
            <RefreshCw
              className={`h-4 w-4 ${monitor.isFetching ? "animate-spin" : ""}`}
            />
            {monitor.isFetching ? "Verificando..." : "Atualizar Status"}
          </Button>

          {unreadAlerts.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={markingAll}
              onClick={handleMarkAllRead}
              className="button button-secondary"
            >
              <CheckCheck className="h-4 w-4" />
              {markingAll ? "Marcando..." : "Marcar Todos como Lidos"}
            </Button>
          )}

          <ConnectAccount onConnected={handleRefreshDiagnostic} />
        </div>
      </header>

      {/* Overview Stat Cards */}
      <section className="grid stats-grid" aria-label="Resumo de Saúde">
        <div className="stat-card">
          <div className="label">Contas Monitoradas</div>
          <div className="value">{accounts.length}</div>
          <div className="hint">
            <Instagram className="h-3.5 w-3.5" /> perfis profissionais
          </div>
        </div>

        <div className="stat-card">
          <div className="label">100% Operacionais</div>
          <div className="value text-emerald-400">
            {accounts.length - degradedAccounts.length}
          </div>
          <div className="hint">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> sem
            bloqueios na Meta
          </div>
        </div>

        <div className="stat-card">
          <div className="label">Precisam de Atenção</div>
          <div
            className={`value ${degradedAccounts.length > 0 ? "text-rose-400 font-bold" : ""}`}
          >
            {degradedAccounts.length}
          </div>
          <div className="hint">
            <ShieldAlert className="h-3.5 w-3.5 text-rose-400" /> reconexão ou
            permissão
          </div>
        </div>

        <div className="stat-card">
          <div className="label">Alertas Não Lidos</div>
          <div
            className={`value ${unreadAlerts.length > 0 ? "text-amber-400 font-bold" : ""}`}
          >
            {unreadAlerts.length}
          </div>
          <div className="hint">
            <Bell className="h-3.5 w-3.5 text-amber-400" /> notificações no sino
          </div>
        </div>
      </section>

      {/* Action Banner if degraded accounts exist */}
      {degradedAccounts.length > 0 && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 flex flex-wrap items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-6 w-6 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-rose-200 text-base block font-semibold">
                {degradedAccounts.length} conta(s) com token expirado ou
                reconexão necessária!
              </strong>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                Contas desconectadas ou com permissões revogadas não conseguem
                publicar agendamentos automáticos. Reconecte pelo login oficial
                abaixo para retomar.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {degradedAccounts.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1 rounded-md bg-rose-950/70 border border-rose-500/40 px-2 py-0.5 text-xs text-rose-200 font-mono"
                  >
                    @{a.username}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ConnectAccount onConnected={handleRefreshDiagnostic} />
          </div>
        </div>
      )}

      {/* Tabs navigation */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-3 overflow-x-auto">
        <button
          type="button"
          onClick={() => setTab("pending")}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${
            tab === "pending"
              ? "bg-white text-black shadow-sm"
              : "text-muted-foreground hover:bg-white/5 hover:text-white"
          }`}
        >
          <AlertTriangle className="h-4 w-4" />
          Pendentes
          {activeAlerts.length > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                tab === "pending"
                  ? "bg-black text-white"
                  : "bg-rose-500 text-white"
              }`}
            >
              {activeAlerts.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setTab("matrix")}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${
            tab === "matrix"
              ? "bg-white text-black shadow-sm"
              : "text-muted-foreground hover:bg-white/5 hover:text-white"
          }`}
        >
          <ShieldCheck className="h-4 w-4" />
          Saúde das Contas ({accounts.length})
        </button>

        <button
          type="button"
          onClick={() => setTab("all")}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${
            tab === "all"
              ? "bg-white text-black shadow-sm"
              : "text-muted-foreground hover:bg-white/5 hover:text-white"
          }`}
        >
          Todos os Alertas ({alerts.length})
        </button>

        <button
          type="button"
          onClick={() => setTab("resolved")}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${
            tab === "resolved"
              ? "bg-white text-black shadow-sm"
              : "text-muted-foreground hover:bg-white/5 hover:text-white"
          }`}
        >
          <CheckCircle2 className="h-4 w-4" />
          Resolvidos ({resolvedAlerts.length})
        </button>
      </div>

      {/* TAB CONTENT: MATRIX (Per-account status table) */}
      {tab === "matrix" && (
        <section className="panel" aria-label="Matriz de Contas">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Status em Tempo Real por Conta</h2>
              <p className="panel-copy">
                Situação da chave de acesso e verificação em segundo plano na
                Meta.
              </p>
            </div>
            <Link className="link" to="/disparo/instagram">
              Gerenciar Contas <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {!accounts.length ? (
            <div className="empty">
              Nenhuma conta do Instagram conectada ainda. Conecte pelo botão
              acima.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-xs text-muted-foreground">
                    <th className="py-3 px-4 font-normal">Perfil</th>
                    <th className="py-3 px-4 font-normal">Status Meta</th>
                    <th className="py-3 px-4 font-normal">
                      Última Verificação
                    </th>
                    <th className="py-3 px-4 font-normal">Última Ativa</th>
                    <th className="py-3 px-4 font-normal text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {accounts.map((acc) => {
                    const health = healthMap.get(acc.id);
                    const conn = connections.find(
                      (c) => c.account_id === acc.id,
                    );
                    const state: HealthState =
                      health?.state ??
                      (conn?.reconnect_required ? "reconnect" : "unknown");
                    const needsAction =
                      state === "reconnect" ||
                      state === "permissions" ||
                      conn?.reconnect_required;

                    return (
                      <tr key={acc.id} className="hover:bg-white/[0.02]">
                        <td className="py-4 px-4 font-medium flex items-center gap-2.5">
                          <span className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-semibold">
                            <Instagram className="h-4 w-4" />
                          </span>
                          <div>
                            <span className="block font-semibold">
                              @{acc.username}
                            </span>
                            {conn?.paused && (
                              <span className="text-[11px] text-amber-400 block">
                                Automação pausada
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          {renderStateBadge(state)}
                        </td>
                        <td className="py-4 px-4 text-xs text-muted-foreground">
                          {health?.checked_at
                            ? new Date(health.checked_at).toLocaleString("pt-BR")
                            : "Aguardando verificação"}
                        </td>
                        <td className="py-4 px-4 text-xs text-muted-foreground">
                          {health?.last_healthy_at
                            ? new Date(health.last_healthy_at).toLocaleString(
                                "pt-BR",
                              )
                            : "—"}
                        </td>
                        <td className="py-4 px-4 text-right">
                          {needsAction ? (
                            <ConnectAccount
                              onConnected={handleRefreshDiagnostic}
                            />
                          ) : (
                            <a
                              href={`https://instagram.com/${acc.username.replace(/^@/, "")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-muted-foreground hover:text-white inline-flex items-center gap-1"
                            >
                              Abrir <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* TAB CONTENT: ALERTS LIST */}
      {tab !== "matrix" && (
        <section className="space-y-3" aria-label="Lista de Alertas">
          {monitor.isLoading ? (
            <div className="p-8 text-center text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Carregando diagnósticos da Meta...
            </div>
          ) : displayedAlerts.length === 0 ? (
            <div className="panel p-8 text-center flex flex-col items-center justify-center gap-3">
              <CheckCircle2 className="h-10 w-10 text-emerald-400" />
              <div>
                <strong className="text-white text-base block">
                  Nenhum alerta registrado
                </strong>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  {tab === "pending"
                    ? "Todas as suas contas estão respondendo perfeitamente e prontas para publicar."
                    : "Nenhum histórico nesta categoria."}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              {displayedAlerts.map((alert: AccountAlert) => {
                const username = accountMap.get(alert.account_id) || "conta";
                const isUnread = !alert.read_at && !alert.resolved_at;
                const isResolved = !!alert.resolved_at;
                const needsReconnect =
                  alert.state === "reconnect" ||
                  alert.state === "permissions";

                return (
                  <article
                    key={alert.id}
                    className={`rounded-2xl border p-5 transition-all flex flex-col sm:flex-row sm:items-start justify-between gap-4 ${
                      isResolved
                        ? "border-white/10 bg-white/[0.01] opacity-75"
                        : isUnread
                          ? "border-amber-500/40 bg-amber-500/[0.04]"
                          : "border-white/10 bg-white/[0.03]"
                    }`}
                  >
                    <div className="space-y-2 flex-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="font-semibold text-white flex items-center gap-1.5">
                          <Instagram className="h-4 w-4 text-rose-400" />
                          @{username}
                        </span>
                        {renderStateBadge(alert.state, isResolved)}
                        {isUnread && (
                          <span className="badge badge-yellow text-[10px]">
                            Novo não lido
                          </span>
                        )}
                      </div>

                      <h3 className="text-base font-semibold text-white">
                        {healthLabels[alert.state]}
                      </h3>

                      <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
                        {healthDetails[alert.state]}
                      </p>

                      <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-3 pt-1">
                        <span>
                          Gerado em:{" "}
                          {new Date(alert.created_at).toLocaleString("pt-BR")}
                        </span>
                        {alert.read_at && (
                          <span>
                            · Visualizado em:{" "}
                            {new Date(alert.read_at).toLocaleString("pt-BR")}
                          </span>
                        )}
                        {alert.resolved_at && (
                          <span className="text-emerald-400">
                            · Resolvido em:{" "}
                            {new Date(alert.resolved_at).toLocaleString(
                              "pt-BR",
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 self-start pt-1">
                      {needsReconnect && !isResolved && (
                        <ConnectAccount onConnected={handleRefreshDiagnostic} />
                      )}

                      {!alert.read_at && !isResolved && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={readingId === alert.id}
                          onClick={() => handleMarkRead(alert.id)}
                        >
                          {readingId === alert.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCheck className="h-3.5 w-3.5 mr-1" />
                          )}
                          Marcar como lido
                        </Button>
                      )}

                      <a
                        href={`https://instagram.com/${username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="button button-secondary text-xs py-1.5 px-3"
                      >
                        Perfil <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
