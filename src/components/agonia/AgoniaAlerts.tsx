import "./account-alerts.css";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCheck,
  ExternalLink,
  Instagram,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConnectAccount } from "@/features/instagram-publisher/ConnectAccount";
import {
  accountHealthState,
  confirmedHealthy,
  healthDetails,
  healthLabels,
  type HealthState,
  monitorRequest,
  needsNewCheck,
} from "@/features/instagram-publisher/monitor";
import { useInstagramMonitor } from "@/features/instagram-publisher/InstagramAlerts";
import type { Connection } from "@/features/instagram-publisher/api";
import type { AccountMetaMap } from "@/features/agonia/schedule";

type Tab = "pending" | "matrix" | "all" | "resolved";
function date(value?: string | null) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("pt-BR")
    : "Ainda não verificada";
}
function StateBadge(
  { state, resolved = false }: { state: HealthState; resolved?: boolean },
) {
  const tone = resolved || state === "healthy"
    ? "green"
    : state === "reconnect" || state === "permissions"
    ? "red"
    : state === "unknown"
    ? "gray"
    : "yellow";
  return (
    <span className={`badge badge-${tone}`}>
      {resolved ? "Encerrado" : healthLabels[state]}
    </span>
  );
}
export function AgoniaAlerts(
  {
    accounts,
    connections,
    onRefresh,
    accountsPending = false,
    accountsError = false,
    accountMeta = {},
    accountFolders = [],
  }: {
    accounts: { id: string; username: string }[];
    connections: Connection[];
    onRefresh: () => Promise<unknown>;
    accountsPending?: boolean;
    accountsError?: boolean;
    accountMeta?: AccountMetaMap;
    accountFolders?: string[];
  },
) {
  const monitor = useInstagramMonitor();
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pending");
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState("*");
  const availableFolders = useMemo(
    () => [
      ...new Set([
        ...accountFolders.map((f) => f.trim()).filter(Boolean),
        ...accounts
          .map((a) => accountMeta[a.id]?.folder?.trim() || "")
          .filter(Boolean),
      ]),
    ],
    [accountFolders, accounts, accountMeta],
  );
  const alerts = monitor.data?.alerts ?? [];
  const healthMap = useMemo(
    () => new Map((monitor.data?.health ?? []).map((h) => [h.account_id, h])),
    [monitor.data?.health],
  );
  const connectionMap = useMemo(
    () => new Map(connections.map((c) => [c.account_id, c])),
    [connections],
  );
  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.username.replace(/^@/, "")])),
    [accounts],
  );
  const pending = alerts.filter((a) => !a.resolved_at);
  const unread = pending.filter((a) => !a.read_at);
  const resolved = alerts.filter((a) => a.resolved_at);
  const degraded = accounts.filter((a) =>
    !["healthy", "unknown"].includes(
      accountHealthState(
        healthMap.get(a.id),
        connectionMap.get(a.id)?.reconnect_required,
      ),
    )
  );
  const healthy = accounts.filter((a) =>
    confirmedHealthy(
      healthMap.get(a.id),
      connectionMap.get(a.id)?.reconnect_required,
    )
  ).length;
  const waiting = accounts.length - degraded.length - healthy;
  const unavailable = monitor.isError || accountsError;
  const loading = monitor.isPending || accountsPending;
  const uncertain = unavailable || loading;
  const query = search.trim().replace(/^@/, "").toLocaleLowerCase("pt-BR");
  const matches = (accountId: string) => {
    const folder = accountMeta[accountId]?.folder?.trim() || "";
    if (folderFilter !== "*" && folder !== folderFilter) return false;
    return (accountMap.get(accountId) ?? "").toLocaleLowerCase("pt-BR").includes(
      query,
    );
  };
  const displayed =
    (tab === "pending" ? pending : tab === "resolved" ? resolved : alerts)
      .filter((a) => matches(a.account_id));
  const filteredAccounts = accounts.filter((a) => matches(a.id));

  async function reload() {
    setBusy("reload");
    try {
      await Promise.all(
        accounts.map((account) =>
          monitorRequest("refresh", account.id).catch(() => null)
        ),
      );
      await onRefresh();
      await monitor.refetch({ throwOnError: true });
      toast.success("Lista de alertas atualizada.");
    } catch {
      toast.error("Não foi possível atualizar os dados. Tente novamente.");
    } finally {
      setBusy(null);
    }
  }
  async function markRead(id?: string) {
    setBusy(id ?? "read_all");
    try {
      const result = id
        ? await monitorRequest("read", id)
        : await monitorRequest("read_all");
      await monitor.refetch({ throwOnError: true });
      toast.success(
        result.updated
          ? `${result.updated} alerta(s) marcado(s) como lido(s).`
          : "Os alertas já foram lidos ou encerrados.",
      );
    } catch {
      toast.error(
        "Não foi possível confirmar a leitura dos alertas. Atualize e tente novamente.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function verify(accountId: string) {
    setBusy(`check:${accountId}`);
    try {
      const result = await monitorRequest("refresh", accountId);
      await onRefresh();
      await monitor.refetch({ throwOnError: true });
      if (result.status === "busy") {
        toast.info(
          "Esta conta já está sendo verificada. Atualize a lista em instantes.",
        );
      } else if (result.status === "recent") {
        toast.info(
          "Conta verificada há menos de 1 minuto. Aguarde antes de consultar novamente.",
        );
      } else {
        toast.success(
          "Verificação concluída. Confira o diagnóstico da conta.",
        );
      }
    } catch {
      toast.error(
        "Não foi possível verificar a conta. O diagnóstico anterior foi preservado.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function connected() {
    await onRefresh();
    await monitor.refetch({ throwOnError: true });
  }
  function profile(accountId: string) {
    const username = accountMap.get(accountId);
    return username
      ? (
        <a
          href={`https://www.instagram.com/${encodeURIComponent(username)}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="button button-secondary"
        >
          Perfil <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )
      : null;
  }
  const tabs: { id: Tab; title: string; count: number }[] = [
    { id: "pending", title: "Pendentes", count: pending.length },
    { id: "matrix", title: "Saúde das contas", count: accounts.length },
    { id: "all", title: "Todos", count: alerts.length },
    { id: "resolved", title: "Encerrados", count: resolved.length },
  ];

  return (
    <div className="agonia-alerts-view space-y-6">
      <header className="topbar">
        <div>
          <h1 className="page-title">Alertas de contas</h1>
          <p className="page-subtitle">
            Acompanhe a conexão dos seus perfis com a Meta. As verificações
            automáticas ocorrem normalmente a cada 5 minutos.
          </p>
        </div>
        <div className="action-row">
          <Button
            variant="outline"
            size="sm"
            className="button button-secondary"
            disabled={!!busy || monitor.isFetching}
            onClick={() => void reload()}
          >
            <RefreshCw
              className={`h-4 w-4 ${
                monitor.isFetching || busy === "reload" ? "animate-spin" : ""
              }`}
            />{" "}
            Atualizar lista
          </Button>
          {!!unread.length && (
            <Button
              variant="outline"
              size="sm"
              className="button button-secondary"
              disabled={!!busy || unavailable}
              onClick={() => void markRead()}
            >
              <CheckCheck className="h-4 w-4" />
              {busy === "read_all" ? "Marcando…" : "Marcar todos como lidos"}
            </Button>
          )}
          <ConnectAccount onConnected={connected} />
        </div>
      </header>

      {unavailable && (
        <div
          role="alert"
          className="rounded-xl border border-border bg-card p-4 space-y-2"
        >
          <strong>Não foi possível atualizar o monitoramento.</strong>
          <p className="text-muted-foreground">
            Os dados anteriores podem estar desatualizados. Isso não confirma
            que as contas estão saudáveis ou desconectadas. Use Atualizar lista
            para tentar novamente.
          </p>
        </div>
      )}

      <section className="stats-grid" aria-label="Resumo das contas">
        {[
          {
            label: "Contas conectadas",
            value: accountsPending || accountsError ? "—" : accounts.length,
            hint: "Perfis adicionados ao site",
          },
          {
            label: "Conexão verificada",
            value: uncertain ? "—" : healthy,
            hint: "Resposta recente da Meta",
          },
          {
            label: "Precisam de atenção",
            value: uncertain ? "—" : degraded.length,
            hint: "Consulte o diagnóstico abaixo",
          },
          {
            label: "Alertas não lidos",
            value: monitor.isPending || monitor.isError ? "—" : unread.length,
            hint: "Ler não resolve o problema",
          },
        ].map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="label">{stat.label}</div>
            <div className="value">{stat.value}</div>
            <div className="hint">{stat.hint}</div>
          </div>
        ))}
      </section>

      <div className="text-sm text-muted-foreground space-y-1" role="status">
        <p>
          {monitor.dataUpdatedAt
            ? `Lista atualizada em ${
              date(new Date(monitor.dataUpdatedAt).toISOString())
            }. Cada conta tem sua própria data de verificação.`
            : "Aguardando os dados do monitoramento."}
        </p>
        {!uncertain && waiting > 0 && (
          <p>
            {waiting}{" "}
            conta(s) aguardando verificação, confirmação de falha ou uma
            checagem recente.
          </p>
        )}
        <p>
          A conexão ativa não garante todas as permissões de publicação. Marcar
          como lido mantém o alerta pendente até o diagnóstico mudar.
        </p>
      </div>

      {!uncertain && degraded.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <strong>{degraded.length} conta(s) precisam de atenção</strong>
            <p className="text-sm text-muted-foreground mt-1">
              As causas podem ser acesso expirado, permissões ou falhas da API.
              Consulte Saúde das contas para ver a ação adequada para cada
              perfil.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <nav
          aria-label="Filtros de alertas"
          className="flex gap-2 overflow-x-auto pb-2"
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`shrink-0 rounded-lg px-4 py-2 text-sm ${
                tab === item.id
                  ? "bg-foreground text-background"
                  : "bg-card text-muted-foreground"
              }`}
            >
              {item.title} ({uncertain ? "—" : item.count})
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 max-w-md">
            <Search className="h-4 w-4 text-muted-foreground" />
            <span className="sr-only">Buscar conta</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar pelo @ da conta"
              className="w-full min-w-0 bg-transparent py-1 outline-none"
            />
          </label>
          <select
            aria-label="Filtrar alertas por pasta"
            value={folderFilter}
            onChange={(e) => setFolderFilter(e.target.value)}
            className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground"
          >
            <option value="*">Pastas: todas</option>
            <option value="">Sem pasta</option>
            {availableFolders.map((folder) => (
              <option key={folder} value={folder}>
                {folder}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading
        ? (
          <div role="status" className="panel flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />{" "}
            Carregando diagnósticos…
          </div>
        )
        : tab === "matrix"
        ? (
          <section className="panel" aria-label="Saúde das contas">
            <div className="panel-header">
              <h2 className="panel-title">Diagnóstico por conta</h2>
              <Link className="link" to="/avanca/instagram">
                Gerenciar contas <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {!filteredAccounts.length
              ? (
                <p className="empty">
                  {query || folderFilter !== "*"
                    ? "Nenhuma conta corresponde à busca."
                    : accountsError
                    ? "Não foi possível carregar as contas."
                    : "Conecte uma conta para iniciar o monitoramento."}
                </p>
              )
              : (
                <div className="overflow-x-auto">
                  <table className="alerts-account-table table w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th>Perfil</th>
                        <th>Diagnóstico</th>
                        <th>Última verificação</th>
                        <th>Última resposta positiva</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAccounts.map((account) => {
                        const health = healthMap.get(account.id);
                        const connection = connectionMap.get(account.id);
                        const state = accountHealthState(
                          health,
                          connection?.reconnect_required,
                        );
                        const reconnect = state === "reconnect" ||
                          state === "permissions";
                        const awaitingConfirmation = !!health?.failures &&
                          health.candidate !== health.state;
                        const folderLabel =
                          accountMeta[account.id]?.folder?.trim() || "Sem pasta";
                        return (
                          <tr key={account.id}>
                            <td>
                              <strong>
                                @{account.username.replace(/^@/, "")}
                              </strong>
                              <small className="block text-muted-foreground">
                                {folderLabel}
                              </small>
                              {connection?.paused && (
                                <small className="block text-muted-foreground">
                                  Automação pausada
                                </small>
                              )}
                            </td>
                            <td className="alerts-account-diagnosis">
                              <StateBadge
                                state={state === "healthy" &&
                                    !confirmedHealthy(
                                      health,
                                      connection?.reconnect_required,
                                    )
                                  ? "unknown"
                                  : state}
                              />
                              <p className="mt-2 text-xs text-muted-foreground">
                                {healthDetails[state]}
                              </p>
                              {awaitingConfirmation && (
                                <p className="text-xs mt-2">
                                  Falha em confirmação; aguardando verificações
                                  consecutivas.
                                </p>
                              )}
                              {needsNewCheck(health) && (
                                <p className="text-xs mt-2">
                                  {health?.checked_at
                                    ? "Verificação desatualizada."
                                    : "Ainda sem verificação."}
                                </p>
                              )}
                            </td>
                            <td
                              data-label="Última verificação"
                              className="whitespace-nowrap"
                            >
                              {date(health?.checked_at)}
                            </td>
                            <td
                              data-label="Última resposta positiva"
                              className="whitespace-nowrap"
                            >
                              {health?.last_healthy_at
                                ? date(health.last_healthy_at)
                                : "—"}
                            </td>
                            <td>
                              <div className="flex flex-wrap gap-2 min-w-[160px]">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!!busy || unavailable}
                                  onClick={() => void verify(account.id)}
                                >
                                  {busy === `check:${account.id}`
                                    ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    )
                                    : <RefreshCw className="h-4 w-4" />}{" "}
                                  Verificar conta
                                </Button>
                                {reconnect && (
                                  <ConnectAccount onConnected={connected} />
                                )}
                                {profile(account.id)}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </section>
        )
        : (
          <section className="space-y-3" aria-label="Lista de alertas">
            {!displayed.length
              ? (
                <div className="panel text-center space-y-2">
                  <Bell className="h-7 w-7 mx-auto" />
                  <h2 className="panel-title">
                    {unavailable
                      ? "Alertas indisponíveis"
                      : query
                      ? "Nenhum resultado para a busca"
                      : "Nenhum alerta nesta categoria"}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {unavailable
                      ? "Tente atualizar a lista para consultar os diagnósticos."
                      : accounts.length
                      ? "Confira a data de verificação de cada perfil em Saúde das contas."
                      : "Conecte uma conta para iniciar o monitoramento."}
                  </p>
                </div>
              )
              : displayed.map((alert) => {
                const username = accountMap.get(alert.account_id);
                const closed = !!alert.resolved_at;
                const needsReconnect = !closed &&
                  ["reconnect", "permissions"].includes(alert.state);
                return (
                  <article
                    key={alert.id}
                    className="rounded-2xl border border-border bg-card p-5 space-y-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Instagram className="h-4 w-4" />
                      <strong>
                        {username
                          ? `@${username}`
                          : "Conta não disponível na lista"}
                      </strong>
                      <StateBadge state={alert.state} resolved={closed} />
                      <span className="text-xs text-muted-foreground">
                        {closed
                          ? "Histórico"
                          : alert.read_at
                          ? "Lido · ainda pendente"
                          : "Não lido"}
                      </span>
                    </div>
                    <div>
                      <h2 className="section-title">
                        {healthLabels[alert.state]}
                      </h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {closed
                          ? "Este diagnóstico foi encerrado. Consulte Saúde das contas para ver a situação atual do perfil."
                          : healthDetails[alert.state]}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>Gerado em {date(alert.created_at)}</span>
                      {alert.read_at && (
                        <span>Lido em {date(alert.read_at)}</span>
                      )}
                      {closed && (
                        <span>Encerrado em {date(alert.resolved_at)}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!closed && !alert.read_at && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!!busy || unavailable}
                          onClick={() => void markRead(alert.id)}
                        >
                          <CheckCheck className="h-4 w-4" /> Marcar como lido
                        </Button>
                      )}
                      {!closed && username && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!!busy || unavailable}
                          onClick={() => void verify(alert.account_id)}
                        >
                          <RefreshCw className="h-4 w-4" /> Verificar conta
                        </Button>
                      )}
                      {needsReconnect && (
                        <ConnectAccount onConnected={connected} />
                      )}
                      {profile(alert.account_id)}
                    </div>
                  </article>
                );
              })}
            {(tab === "all" || tab === "resolved") && (
              <p className="text-xs text-muted-foreground">
                Histórico dos últimos {monitor.data?.history_limit ?? 100}{" "}
                alertas encerrados. Todos os alertas ativos são mantidos na
                lista.
              </p>
            )}
          </section>
        )}
    </div>
  );
}
