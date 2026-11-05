import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { listAccounts, publisherRequest } from "./api";
import type { VideoMetric } from "../../../supabase/functions/instagram-publisher/analytics";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Report = {
  accounts: {
    account_id: string;
    videos: VideoMetric[];
    complete: boolean;
    nextCursor?: string | null;
    unavailable: boolean;
  }[];
  checked_at: string;
};
const number = (n: number) => n.toLocaleString("pt-BR");
export function InstagramAnalytics() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const [loadingMore, setLoadingMore] = useState(false);
  async function loadMore() {
    if (!report.data || loadingMore) return;
    setLoadingMore(true);
    try {
      for (const current of report.data.accounts.filter((a) => a.nextCursor)) {
        const next = await publisherRequest<Report>("analytics", {
          account_id: current.account_id,
          after: current.nextCursor,
        });
        const page = next.accounts.find(
          (a) => a.account_id === current.account_id,
        );
        if (!page || page.unavailable)
          throw new Error(
            "Não foi possível carregar mais vídeos. Tente novamente.",
          );
        cache.setQueryData<Report>(["ig-analytics", user?.id], (previous) =>
          previous
            ? {
                ...previous,
                checked_at: next.checked_at,
                accounts: previous.accounts.map((a) =>
                  a.account_id === current.account_id
                    ? {
                        ...page,
                        videos: [
                          ...new Map(
                            [...a.videos, ...page.videos].map((v) => [v.id, v]),
                          ).values(),
                        ],
                      }
                    : a,
                ),
              }
            : previous,
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar mais vídeos.",
      );
    } finally {
      setLoadingMore(false);
    }
  }
  const [period, setPeriod] = useState("all");
  const [account, setAccount] = useState("all");
  const names = useQuery({
    queryKey: ["instagram-publisher-accounts", user?.id],
    queryFn: () => listAccounts(user!.id),
    enabled: !!user,
  });
  const report = useQuery({
    queryKey: ["ig-analytics", user?.id],
    queryFn: () => publisherRequest<Report>("analytics"),
    enabled: !!user,
    staleTime: 300000,
    retry: false,
  });
  const accounts =
    report.data?.accounts.filter(
      (a) => account === "all" || a.account_id === account,
    ) ?? [];
  const cutoff = period === "all" ? 0 : Date.now() - Number(period) * 86400000;
  const videos = accounts
    .flatMap((a) => a.videos)
    .filter((v) => Date.parse(v.timestamp) >= cutoff);
  const measured = videos
    .filter((v): v is VideoMetric & { views: number } => v.views !== null)
    .sort((a, b) => b.views - a.views);
  const total = measured.reduce((sum, v) => sum + v.views, 0);
  const name = (id: string) =>
    "@" +
    (names.data?.find((a) => a.id === id)?.username.replace(/^@/, "") ||
      "perfil");
  return (
    <section
      className="operation-panel ig-panel space-y-6"
      aria-label="Analytics do Instagram"
    >
      <div className="ig-panel-head">
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
          onClick={() => void report.refetch()}
        >
          {report.isFetching ? "Atualizando…" : "Atualizar métricas"}
        </Button>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="text-sm">
          Vídeos publicados
          <select
            className="block rounded-md border bg-background p-2"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option value="all">Todo o histórico consultado</option>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
          </select>
        </label>
        <label className="text-sm">
          Conta
          <select
            className="block rounded-md border bg-background p-2"
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
      {report.isPending ? (
        <p role="status">Consultando visualizações no Instagram…</p>
      ) : report.isError ? (
        <p role="alert">
          Não foi possível carregar as métricas. Tente atualizar novamente.
        </p>
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
                    <strong>{name(v.account_id)}</strong>
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
          <div className="ig-table-scroll">
            <table className="ig-table">
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>Visualizações acumuladas</th>
                  <th>Vídeos com métricas</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const rows = measured.filter(
                    (v) => v.account_id === a.account_id,
                  );
                  return (
                    <tr key={a.account_id}>
                      <td>{name(a.account_id)}</td>
                      <td>
                        {rows.length
                          ? number(rows.reduce((sum, v) => sum + v.views, 0))
                          : "Indisponível"}
                      </td>
                      <td>{rows.length}</td>
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
