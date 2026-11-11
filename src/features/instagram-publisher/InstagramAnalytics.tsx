import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { listAccounts } from "./api";
import { useInstagramAnalytics } from "./useInstagramAnalytics";
import type { VideoMetric } from "../../../supabase/functions/instagram-publisher/analytics";
import { Button } from "@/components/ui/button";

const number = (n: number) => n.toLocaleString("pt-BR");
export function InstagramAnalytics() {
  const { user } = useAuth();
  const { report, loadingMore, loadMore } = useInstagramAnalytics(user?.id);
  const [period, setPeriod] = useState("all");
  const [account, setAccount] = useState("all");
  const names = useQuery({
    queryKey: ["instagram-publisher-accounts", user?.id],
    queryFn: () => listAccounts(user!.id),
    enabled: !!user,
  });
  const accounts =
    report.data?.accounts.filter(
      (a) => account === "all" || a.account_id === account,
    ) ?? [];
  const cutoff = period === "all" ? -Infinity : Date.now() - Number(period) * 86400000;
  const now = Date.now();
  const videos = accounts
    .flatMap((a) => a.videos)
    .filter((v) => Date.parse(v.timestamp) >= cutoff && Date.parse(v.timestamp) <= now);
  const measured = videos
    .filter((v): v is VideoMetric & { views: number } => v.views !== null)
    .sort((a, b) => b.views - a.views);
  const total = measured.reduce((sum, v) => sum + v.views, 0);
  const accountTotals = accounts.map((a) => {
    const rows = measured.filter((v) => v.account_id === a.account_id);
    return { ...a, count: rows.length, total: rows.reduce((sum, v) => sum + v.views, 0) };
  }).sort((a, b) => b.total - a.total);
  const maxAccountViews = Math.max(1, ...accountTotals.map((a) => a.total));
  const name = (id: string) =>
    "@" +
    (names.data?.find((a) => a.id === id)?.username.replace(/^@/, "") ||
      id);
  return (
    <section
      className="operation-panel ig-panel space-y-6"
      aria-label="Analytics do Instagram"
    >
      <div className="ig-panel-head flex-wrap">
        <div>
          <p className="ig-eyebrow">Performance · todas as contas</p>
          <h2>Visualizações dos seus vídeos</h2>
          <p className="text-sm text-muted-foreground">
            Descubra o que mais atrai a sua audiência.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={report.isFetching || loadingMore}
          onClick={() => { void names.refetch(); void report.refetch(); }}
        >
          {report.isFetching ? "Atualizando…" : "Atualizar métricas"}
        </Button>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="min-w-0 max-w-full text-sm">
          Vídeos publicados
          <select
            className="block max-w-full rounded-md border bg-background p-2"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option value="all">Todo o histórico consultado</option>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
          </select>
        </label>
        <label className="min-w-0 max-w-full text-sm">
          Conta
          <select
            className="block max-w-full rounded-md border bg-background p-2"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="all">Todas as contas</option>
            {names.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {name(a.id)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {names.isError && (
        <p role="alert">Não foi possível carregar os nomes das contas. Atualize as métricas para tentar novamente.</p>
      )}
      {report.isPending ? (
        <p role="status">Consultando visualizações no Instagram…</p>
      ) : report.isError ? (
        <p role="alert">
          Não foi possível carregar as métricas. Tente atualizar novamente.
        </p>
      ) : !report.data?.accounts.length ? (
        <div className="rounded-xl border p-6 text-sm space-y-3">
          <p>Nenhuma conta do Instagram conectada para analisar.</p>
          <a className="underline" href="/avanca/conectar">Conectar conta do Instagram</a>
        </div>
      ) : (
        <>
          {!!accounts.some((a) => !a.complete || a.unavailable) && (
            <p role="status" className="ig-warning">
              Relatório parcial: ainda há publicações para consultar ou contas
              indisponíveis. Carregue mais vídeos para ampliar o ranking e os
              totais. Algumas métricas exigem permissão de insights.
            </p>
          )}
          {report.data?.accounts.some((a) => a.nextCursor) && (
            <Button
              variant="outline"
              disabled={loadingMore || report.isFetching}
              onClick={() => void loadMore()}
            >
              {loadingMore
                ? "Consultando mais vídeos…"
                : "Carregar mais vídeos de todas as contas"}
            </Button>
          )}
          <div className="ig-pulse">
            {[
              [
                "Visualizações totais dos vídeos consultados",
                measured.length ? number(total) : "—",
              ],
              [
                "Média por vídeo com métricas",
                measured.length
                  ? number(Math.round(total / measured.length))
                  : "—",
              ],
              ["Vídeos com métricas", `${measured.length}/${videos.length}`],
              [
                "Contas consultadas",
                String(accounts.filter((a) => !a.unavailable).length),
              ],
            ].map(([label, value]) => (
              <div className="ig-stat" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Visualizações acumuladas de cada vídeo, incluindo repetições. O
            filtro seleciona a data de publicação; não representa visualizações
            ganhas no período. Dados indisponíveis não são tratados como zero.
          </p>
          <h3 className="font-medium">Top 10 vídeos por visualizações</h3>
          {!measured.length ? (
            <p>Nenhum vídeo com visualizações disponíveis nesta seleção.</p>
          ) : (
            <ol className="space-y-3">
              {measured.slice(0, 10).map((v, i) => (
                <li
                  key={`${v.account_id}-${v.id}`}
                  className="flex items-center gap-4 rounded-xl border border-white/10 p-3"
                >
                  <span className="ig-rank">{i + 1}</span>
                  {v.thumbnail_url && /^https:\/\//i.test(v.thumbnail_url) && (
                    <img
                      src={v.thumbnail_url}
                      alt="Capa do vídeo"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="h-20 w-14 rounded-lg object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate">{name(v.account_id)}</strong>
                    <p className="truncate text-sm text-muted-foreground">
                      {v.caption}
                    </p>
                    {v.permalink && /^https:\/\//i.test(v.permalink) && (
                      <a
                        href={v.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs underline"
                      >
                        Ver no Instagram
                      </a>
                    )}
                  </div>
                  <div className="text-right">
                    <strong>{number(v.views)}</strong>
                    <p className="text-xs text-muted-foreground">
                      visualizações
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <h3 className="font-medium">Relatório por conta</h3>
          <div className="space-y-4" role="img" aria-label="Comparação das visualizações acumuladas por conta; valores detalhados na tabela abaixo">
            {accountTotals.filter((a) => a.count > 0).map((a) => (
              <div key={a.account_id} className="space-y-1">
                <div className="flex min-w-0 justify-between gap-3 text-sm">
                  <span className="truncate">{name(a.account_id)}</span>
                  <span>{number(a.total)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${a.total / maxAccountViews * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="ig-table-scroll">
            <table className="ig-table">
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>Visualizações acumuladas</th>
                  <th>Vídeos com métricas</th>
                  <th>Consulta</th>
                </tr>
              </thead>
              <tbody>
                {accountTotals.map((a) => {
                  return (
                    <tr key={a.account_id}>
                      <td>{name(a.account_id)}</td>
                      <td>
                        {a.count
                          ? number(a.total)
                          : "Indisponível"}
                      </td>
                      <td>{a.count}</td>
                      <td>{a.unavailable ? "Conta indisponível" : !a.complete ? "Consulta parcial" : "Consulta concluída"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Atualizado em{" "}
            {report.data &&
              new Date(report.data.checked_at).toLocaleString("pt-BR")}
            . Métricas fornecidas pela Meta podem ter atraso.
          </p>
        </>
      )}
    </section>
  );
}
