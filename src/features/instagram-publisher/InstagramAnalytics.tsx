import { InsightsPermissionNotice } from "./InsightsPermissionNotice";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  collectAllKnownAccountFolders,
  groupAccountsByFolder,
  loadAccountFolders,
  loadAccountMeta,
  saveAccountFolders,
  saveAccountMeta,
  type AccountMetaMap,
} from "@/features/agonia/schedule";
import { listAccounts } from "./api";
import {
  type AnalyticsReport,
  type FollowerHistoryPoint,
  useInstagramAnalytics,
} from "./useInstagramAnalytics";
import type { VideoMetric } from "../../../supabase/functions/instagram-publisher/analytics";
import { Button } from "@/components/ui/button";

const number = (n: number) => n.toLocaleString("pt-BR");
const signed = (n: number) => `${n >= 0 ? "+" : ""}${number(n)}`;
type AccountReport = AnalyticsReport["accounts"][number];
type RankMetric = "views" | "likes" | "interactions";

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Computes net follower change over `days` from daily snapshots.
 * Returns null until at least two snapshots exist, so missing data never looks like 0.
 */
function followerDelta(
  current: number | null,
  history: FollowerHistoryPoint[] | undefined,
  days: number,
  nowMs: number,
): number | null {
  if (current === null || !history?.length) return null;
  const targetDay = new Date(nowMs - days * 86400000).toISOString().slice(0, 10);
  const sorted = [...history].sort((a, b) => a.day.localeCompare(b.day));
  const baseline =
    [...sorted].reverse().find((p) => p.day <= targetDay) ??
    (sorted.length > 1 ? sorted[0] : null);
  const today = new Date(nowMs).toISOString().slice(0, 10);
  if (!baseline || baseline.day === today) return null;
  return current - baseline.followers_count;
}

function interactionTotal(v: VideoMetric): number | null {
  if (validCount(v.interactions)) return v.interactions;
  const parts = [v.likes, v.comments, v.shares, v.saves].filter(validCount);
  return parts.length ? parts.reduce((sum, n) => sum + n, 0) : null;
}

export function InstagramAnalytics() {
  const { user } = useAuth();
  const { report, loadingMore, loadMore, refreshMetrics } = useInstagramAnalytics(
    user?.id,
    true,
    30_000,
  );
  const [period, setPeriod] = useState("all");
  const [folder, setFolder] = useState("*");
  const [account, setAccount] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [rankBy, setRankBy] = useState<RankMetric>("views");
  const [newFolderName, setNewFolderName] = useState("");
  const [assignAccountId, setAssignAccountId] = useState("");
  const [assignFolderName, setAssignFolderName] = useState("");
  const [accountMeta, setAccountMeta] = useState<AccountMetaMap>(() =>
    loadAccountMeta(user?.id),
  );
  const [accountFolders, setAccountFolders] = useState<string[]>(() =>
    loadAccountFolders(user?.id),
  );
  useEffect(() => {
    const sync = () => {
      setAccountMeta(loadAccountMeta(user?.id));
      setAccountFolders(loadAccountFolders(user?.id));
    };
    sync();
    window.addEventListener("agonia-account-folders-updated", sync);
    return () => window.removeEventListener("agonia-account-folders-updated", sync);
  }, [user?.id]);

  const names = useQuery({
    queryKey: ["instagram-publisher-accounts", user?.id],
    queryFn: () => listAccounts(user!.id),
    enabled: !!user,
    refetchInterval: 60_000,
  });

  // Fallback to report account IDs so folders and selectors work even before listAccounts resolves.
  const knownAccounts = useMemo(() => {
    const map = new Map<string, { id: string; username: string }>();
    for (const a of names.data ?? []) map.set(a.id, a);
    for (const a of report.data?.accounts ?? []) {
      if (!map.has(a.account_id)) {
        map.set(a.account_id, {
          id: a.account_id,
          username: a.profile?.username || a.account_id,
        });
      }
    }
    return [...map.values()];
  }, [names.data, report.data]);

  const folderGroups = useMemo(
    () => groupAccountsByFolder(knownAccounts, accountMeta, accountFolders),
    [knownAccounts, accountMeta, accountFolders],
  );
  const availableFolders = useMemo(
    () => collectAllKnownAccountFolders(user?.id, accountMeta, accountFolders),
    [user?.id, accountFolders, accountMeta],
  );

  const selectedSet = useMemo(() => {
    if (selectedIds === null) return null;
    return new Set(selectedIds);
  }, [selectedIds]);

  const isAccountActive = (id: string) => {
    if (account !== "all" && id !== account) return false;
    if (folder !== "*") {
      const accFolder = accountMeta[id]?.folder?.trim() || "";
      if (accFolder !== folder) return false;
    }
    if (selectedSet && !selectedSet.has(id)) return false;
    return true;
  };

  const accounts =
    report.data?.accounts.filter((a) => isAccountActive(a.account_id)) ?? [];

  const now = Date.now();
  const cutoff = period === "all" ? -Infinity : now - Number(period) * 86400000;
  const videos = accounts
    .flatMap((a) => a.videos)
    .filter((v) => {
      const time = Date.parse(v.timestamp);
      return Number.isFinite(time) && time >= cutoff && time <= now + 300_000;
    });
  const measured = videos
    .filter((v): v is VideoMetric & { views: number } => validCount(v.views))
    .sort((a, b) => b.views - a.views);
  const likedVideos = videos.filter((v): v is VideoMetric & { likes: number } =>
    validCount(v.likes)
  );
  const commentedVideos = videos.filter((v): v is VideoMetric & { comments: number } =>
    validCount(v.comments)
  );
  const sharedVideos = videos.filter((v): v is VideoMetric & { shares: number } =>
    validCount(v.shares)
  );
  const savedVideos = videos.filter((v): v is VideoMetric & { saves: number } =>
    validCount(v.saves)
  );

  const total = measured.reduce((sum, v) => sum + v.views, 0);
  const totalLikes = likedVideos.reduce((sum, v) => sum + v.likes, 0);
  const totalComments = commentedVideos.reduce((sum, v) => sum + v.comments, 0);
  const totalShares = sharedVideos.reduce((sum, v) => sum + v.shares, 0);
  const totalSaves = savedVideos.reduce((sum, v) => sum + v.saves, 0);

  const accountsWithFollowers = accounts.filter((a) =>
    validCount(a.profile?.followers_count)
  );
  const totalFollowers = accountsWithFollowers.reduce(
    (sum, a) => sum + (a.profile?.followers_count ?? 0),
    0,
  );
  const totalNewFollowers28d = accounts.reduce(
    (acc, a) => {
      const gain = a.overview?.new_followers;
      if (validCount(gain)) {
        acc.available = true;
        acc.total += gain;
      }
      return acc;
    },
    { total: 0, available: false },
  );

  const summarizeAccount = (a: AccountReport) => {
    const accountVideos = videos.filter((v) => v.account_id === a.account_id);
    const rows = measured.filter((v) => v.account_id === a.account_id);
    const likesRows = accountVideos.filter((v): v is VideoMetric & { likes: number } =>
      validCount(v.likes)
    );
    const commentsRows = accountVideos.filter((v): v is VideoMetric & { comments: number } =>
      validCount(v.comments)
    );
    const sharesRows = accountVideos.filter((v): v is VideoMetric & { shares: number } =>
      validCount(v.shares)
    );
    const savesRows = accountVideos.filter((v): v is VideoMetric & { saves: number } =>
      validCount(v.saves)
    );
    const viewsTotal = rows.reduce((sum, v) => sum + v.views, 0);
    const likesTotal = likesRows.reduce((sum, v) => sum + v.likes, 0);
    const commentsTotal = commentsRows.reduce((sum, v) => sum + v.comments, 0);
    const sharesTotal = sharesRows.reduce((sum, v) => sum + v.shares, 0);
    const savesTotal = savesRows.reduce((sum, v) => sum + v.saves, 0);
    const followers = validCount(a.profile?.followers_count)
      ? a.profile!.followers_count!
      : null;
    const hasGenuineZeroVideos =
      !a.unavailable && a.complete && accountVideos.length === 0 && period === "all";
    const cardViews: number | null =
      rows.length > 0
        ? viewsTotal
        : validCount(a.overview?.views) && period === "all"
          ? a.overview!.views!
          : hasGenuineZeroVideos
            ? 0
            : null;
    const cardLikes: number | null =
      likesRows.length > 0
        ? likesTotal
        : validCount(a.overview?.likes) && period === "all"
          ? a.overview!.likes!
          : hasGenuineZeroVideos
            ? 0
            : null;
    const engagementBase = viewsTotal > 0 ? viewsTotal : followers && followers > 0 ? followers : null;
    const interactionsSum = likesTotal + commentsTotal + sharesTotal + savesTotal;
    const engagementRate =
      engagementBase && (likesRows.length > 0 || rows.length > 0)
        ? (interactionsSum / engagementBase) * 100
        : null;
    return {
      ...a,
      folder: accountMeta[a.account_id]?.folder?.trim() || "",
      videoCount: accountVideos.length,
      count: rows.length,
      total: viewsTotal,
      likesCount: likesRows.length,
      likesTotal,
      cardViews,
      cardLikes,
      hasGenuineZeroVideos,
      commentsTotal,
      sharesTotal,
      savesTotal,
      followers,
      follows: validCount(a.profile?.follows_count) ? a.profile!.follows_count! : null,
      mediaCount: validCount(a.profile?.media_count) ? a.profile!.media_count! : null,
      delta7d: followerDelta(followers, a.followers_history, 7, now),
      delta30d: followerDelta(followers, a.followers_history, 30, now),
      newFollowers28d: validCount(a.overview?.new_followers) ? a.overview!.new_followers! : null,
      engagementRate,
    };
  };

  const accountTotals = accounts
    .map(summarizeAccount)
    .sort((a, b) =>
      b.total - a.total ||
      b.likesTotal - a.likesTotal ||
      (b.followers ?? -1) - (a.followers ?? -1)
    );
  const maxAccountViews = Math.max(1, ...accountTotals.map((a) => a.total));

  const allReportAccounts = useMemo(
    () => (report.data?.accounts ?? []).map(summarizeAccount),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [report.data, videos.length, measured.length, accountMeta, period],
  );

  const folderSummaries = useMemo(() => {
    const byId = new Map(allReportAccounts.map((a) => [a.account_id, a]));
    return folderGroups.map((group) => {
      const items = group.accounts
        .map((acc) => byId.get(acc.id))
        .filter((item): item is NonNullable<typeof item> => !!item);
      const withViews = items.filter((i) => i.cardViews !== null);
      const withLikes = items.filter((i) => i.cardLikes !== null);
      const withFollowers = items.filter((i) => i.followers !== null);
      const viewsSum = withViews.reduce((s, i) => s + (i.cardViews ?? 0), 0);
      const likesSum = withLikes.reduce((s, i) => s + (i.cardLikes ?? 0), 0);
      const followersSum = withFollowers.reduce((s, i) => s + (i.followers ?? 0), 0);
      const allIds = group.accounts.map((a) => a.id);
      const activeCount = allIds.filter((id) =>
        selectedSet ? selectedSet.has(id) : folder === "*" || folder === group.folder
      ).length;
      return {
        folder: group.folder,
        label: group.label,
        accountIds: allIds,
        accountCount: group.accounts.length,
        activeCount,
        views: withViews.length ? viewsSum : null,
        likes: withLikes.length ? likesSum : null,
        followers: withFollowers.length ? followersSum : null,
        measuredVideos: items.reduce((s, i) => s + i.count, 0),
      };
    });
  }, [allReportAccounts, folderGroups, selectedSet, folder]);

  const rankedVideos = useMemo(() => {
    if (rankBy === "likes") {
      return [...likedVideos].sort((a, b) => b.likes - a.likes || (b.views ?? 0) - (a.views ?? 0));
    }
    if (rankBy === "interactions") {
      return videos
        .map((v) => ({ video: v, score: interactionTotal(v) }))
        .filter((item): item is { video: VideoMetric; score: number } => item.score !== null)
        .sort((a, b) => b.score - a.score)
        .map((item) => item.video);
    }
    return measured;
  }, [rankBy, measured, likedVideos, videos]);

  const name = (id: string) => {
    const found =
      names.data?.find((a) => a.id === id)?.username ||
      report.data?.accounts.find((a) => a.account_id === id)?.profile?.username ||
      id;
    return "@" + found.replace(/^@/, "");
  };

  const folderLabel = (accountId: string) =>
    accountMeta[accountId]?.folder?.trim() || "Sem pasta";

  const selectAllAccounts = () => {
    setFolder("*");
    setAccount("all");
    setSelectedIds(null);
  };

  const toggleFolderSelection = (targetFolder: string, ids: string[]) => {
    setAccount("all");
    if (selectedSet) {
      const allSelected = ids.length > 0 && ids.every((id) => selectedSet.has(id));
      const next = new Set(selectedSet);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      setSelectedIds([...next]);
      return;
    }
    setFolder((current) => (current === targetFolder ? "*" : targetFolder));
  };

  const toggleIndividualAccount = (id: string) => {
    setFolder("*");
    setAccount("all");
    const allIds = knownAccounts.map((a) => a.id);
    const current = selectedSet ?? new Set(allIds);
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next.size === allIds.length ? null : [...next]);
  };

  const handleCreateOrAssignFolder = () => {
    if (!user?.id) return;
    const trimmed = (newFolderName.trim() || assignFolderName.trim());
    if (!trimmed && !assignAccountId) return;
    let nextFolders = accountFolders;
    if (trimmed && !accountFolders.includes(trimmed)) {
      nextFolders = [...accountFolders, trimmed];
      setAccountFolders(nextFolders);
      saveAccountFolders(user.id, nextFolders);
    }
    if (assignAccountId) {
      const targetFolder = newFolderName.trim() || assignFolderName;
      const current = accountMeta[assignAccountId] || {
        model: "",
        folder: "",
        dailyTarget: 5,
        notes: "",
      };
      const nextMeta: AccountMetaMap = {
        ...accountMeta,
        [assignAccountId]: { ...current, folder: targetFolder },
      };
      setAccountMeta(nextMeta);
      saveAccountMeta(user.id, nextMeta);
    }
    setNewFolderName("");
  };

  return (
    <section
      className="operation-panel ig-panel space-y-6"
      aria-label="Analytics do Instagram"
    >
      <div className="ig-panel-head flex-wrap">
        <div>
          <p className="ig-eyebrow">Performance · todas as contas</p>
          <h2>Visualizações, curtidas e seguidores</h2>
          <p className="text-sm text-muted-foreground">
            Acompanhe visualizações, curtidas, engajamento e crescimento de seguidores de cada conta e pasta.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={report.isFetching || loadingMore}
          onClick={() => { void names.refetch(); void refreshMetrics(); }}
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
            <option value="90">Últimos 90 dias</option>
          </select>
        </label>
        <label className="min-w-0 max-w-full text-sm">
          Pasta
          <select
            className="block max-w-full rounded-md border bg-background p-2"
            value={folder}
            onChange={(e) => {
              setFolder(e.target.value);
              setAccount("all");
              setSelectedIds(null);
            }}
          >
            <option value="*">Todas as pastas</option>
            <option value="">Sem pasta</option>
            {availableFolders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 max-w-full text-sm">
          Conta
          <select
            className="block max-w-full rounded-md border bg-background p-2"
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setSelectedIds(null);
            }}
          >
            <option value="all">Todas as contas</option>
            {folderGroups
              .filter((g) => folder === "*" || g.folder === folder)
              .map((g) => (
                <optgroup key={g.folder || "__unassigned__"} label={g.label}>
                  {g.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {name(a.id)}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
        </label>
      </div>
      {names.isError && (
        <p role="alert">Não foi possível carregar os nomes das contas. Atualize as métricas para tentar novamente.</p>
      )}
      <InsightsPermissionNotice report={report.data} accounts={names.data ?? []} />
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

          {/* Folder organization and multi-account filter */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-medium text-sm">Desempenho e seleção por pastas</h3>
                <p className="text-xs text-muted-foreground">
                  Selecione todas as contas, uma pasta inteira ou contas individuais para comparar visualizações, curtidas e seguidores.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={selectedIds === null && folder === "*" && account === "all" ? "default" : "outline"}
                  onClick={selectAllAccounts}
                >
                  Todas as contas ({knownAccounts.length})
                </Button>
                {selectedIds !== null && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedIds([])}
                  >
                    Limpar seleção ({selectedIds.length})
                  </Button>
                )}
              </div>
            </div>

            {folderSummaries.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {folderSummaries.map((group) => {
                  const isFocused =
                    (selectedIds === null && folder === group.folder) ||
                    (selectedSet !== null &&
                      group.accountIds.length > 0 &&
                      group.accountIds.every((id) => selectedSet.has(id)));
                  return (
                    <div
                      key={group.folder || "__unassigned__"}
                      className={`rounded-xl border p-3 space-y-2 transition-colors ${
                        isFocused
                          ? "border-primary/60 bg-primary/5"
                          : "border-white/10 bg-background/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className="truncate text-sm">{group.label}</strong>
                        <Button
                          type="button"
                          size="sm"
                          variant={isFocused ? "default" : "outline"}
                          onClick={() => toggleFolderSelection(group.folder, group.accountIds)}
                        >
                          {isFocused ? "Pasta selecionada" : `Selecionar pasta (${group.accountCount})`}
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="block text-muted-foreground">Visualizações</span>
                          <strong>{group.views !== null ? `${number(group.views)} vis.` : "—"}</strong>
                        </div>
                        <div>
                          <span className="block text-muted-foreground">Curtidas</span>
                          <strong>{group.likes !== null ? `${number(group.likes)} curt.` : "—"}</strong>
                        </div>
                        <div>
                          <span className="block text-muted-foreground">Seguidores</span>
                          <strong>{group.followers !== null ? `${number(group.followers)} seg.` : "—"}</strong>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {group.accountIds.map((id) => {
                          const checked = isAccountActive(id);
                          return (
                            <button
                              key={id}
                              type="button"
                              aria-pressed={checked}
                              onClick={() => toggleIndividualAccount(id)}
                              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                                checked
                                  ? "border-primary bg-primary/15 text-foreground"
                                  : "border-white/10 text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {name(id)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none font-medium text-foreground/80 hover:text-foreground">
                Organizar contas em pastas
              </summary>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="text-xs">
                  Conta para mover
                  <select
                    aria-label="Conta para mover de pasta"
                    className="mt-1 block rounded-md border bg-background p-1.5 text-xs text-foreground"
                    value={assignAccountId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setAssignAccountId(id);
                      setAssignFolderName(accountMeta[id]?.folder || "");
                    }}
                  >
                    <option value="">Selecione uma conta</option>
                    {knownAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {name(a.id)} ({folderLabel(a.id)})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  Pasta existente
                  <select
                    aria-label="Pasta existente"
                    className="mt-1 block rounded-md border bg-background p-1.5 text-xs text-foreground"
                    value={assignFolderName}
                    onChange={(e) => setAssignFolderName(e.target.value)}
                  >
                    <option value="">Sem pasta</option>
                    {availableFolders.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  Ou criar nova pasta
                  <input
                    type="text"
                    placeholder="Ex.: Nicho Fitness"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    className="mt-1 block rounded-md border bg-background p-1.5 text-xs text-foreground"
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleCreateOrAssignFolder}
                >
                  Salvar pasta
                </Button>
              </div>
            </details>
          </div>

          <div className="ig-pulse">
            {[
              [
                "Visualizações totais dos vídeos consultados",
                measured.length ? number(total) : "—",
              ],
              [
                "Curtidas totais dos vídeos consultados",
                likedVideos.length ? number(totalLikes) : "—",
              ],
              [
                "Seguidores totais das contas",
                accountsWithFollowers.length ? number(totalFollowers) : "—",
              ],
              [
                "Novos seguidores (28 dias)",
                totalNewFollowers28d.available
                  ? signed(totalNewFollowers28d.total)
                  : "—",
              ],
              [
                "Média por vídeo com métricas",
                measured.length
                  ? number(Math.round(total / measured.length))
                  : "—",
              ],
              [
                "Média de curtidas por vídeo",
                likedVideos.length
                  ? number(Math.round(totalLikes / likedVideos.length))
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

          {(commentedVideos.length > 0 || sharedVideos.length > 0 || savedVideos.length > 0) && (
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              {commentedVideos.length > 0 && (
                <span>Comentários acumulados: <strong className="text-foreground">{number(totalComments)}</strong></span>
              )}
              {sharedVideos.length > 0 && (
                <span>Compartilhamentos: <strong className="text-foreground">{number(totalShares)}</strong></span>
              )}
              {savedVideos.length > 0 && (
                <span>Salvamentos: <strong className="text-foreground">{number(totalSaves)}</strong></span>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Visualizações e curtidas acumuladas de cada vídeo, incluindo repetições.
            Seguidores refletem o total atual reportado pela API oficial da Meta para cada conta.
            O filtro seleciona a data de publicação; dados indisponíveis não são tratados como zero.
          </p>

          {/* Per-account detailed cards */}
          <div className="space-y-3">
            <h3 className="font-medium">Desempenho detalhado por conta</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {accountTotals.map((a) => (
                <div
                  key={a.account_id}
                  className="rounded-xl border border-white/10 bg-white/[0.015] p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {a.profile?.profile_picture_url && (
                        <img
                          src={a.profile.profile_picture_url}
                          alt={`Foto de ${name(a.account_id)}`}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-10 w-10 rounded-full object-cover shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <strong className="block truncate">{name(a.account_id)}</strong>
                        <span className="inline-block rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-muted-foreground">
                          {a.folder || "Sem pasta"}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {a.unavailable
                        ? "Status: indisponível"
                        : !a.complete
                          ? "Status: parcial"
                          : "Status: concluída"}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div className="rounded-lg border border-white/5 bg-background/40 p-2.5">
                      <span className="block text-xs text-muted-foreground">Visualizações</span>
                      <strong>
                        {a.cardViews !== null
                          ? `${number(a.cardViews)} vis.`
                          : !a.unavailable && a.videoCount > 0 && a.insights_error !== "permission_required"
                            ? "Processando…"
                            : "Sem dados"}
                      </strong>
                      {a.overview?.views !== null && a.overview?.views !== undefined ? (
                        <span className="block text-[11px] text-muted-foreground">
                          28d conta: {number(a.overview.views)}
                        </span>
                      ) : a.hasGenuineZeroVideos ? (
                        <span className="block text-[11px] text-muted-foreground">
                          Nenhum vídeo publicado
                        </span>
                      ) : null}
                    </div>
                    <div className="rounded-lg border border-white/5 bg-background/40 p-2.5">
                      <span className="block text-xs text-muted-foreground">Curtidas</span>
                      <strong>
                        {a.cardLikes !== null ? `${number(a.cardLikes)} curt.` : "Sem dados"}
                      </strong>
                      {a.likesCount > 0 && (
                        <span className="block text-[11px] text-muted-foreground">
                          Média: {number(Math.round(a.likesTotal / a.likesCount))}/vídeo
                        </span>
                      )}
                    </div>
                    <div className="rounded-lg border border-white/5 bg-background/40 p-2.5">
                      <span className="block text-xs text-muted-foreground">Seguidores</span>
                      <strong>{a.followers !== null ? `${number(a.followers)} seg.` : "Sem dados"}</strong>
                      {(a.newFollowers28d !== null || a.delta7d !== null || a.delta30d !== null) && (
                        <span className="block text-[11px] text-muted-foreground">
                          {a.newFollowers28d !== null
                            ? `+${number(a.newFollowers28d)} (28d)`
                            : a.delta7d !== null
                              ? `${signed(a.delta7d)} (7d)`
                              : `${signed(a.delta30d!)} (30d)`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      Vídeos medidos: <strong className="text-foreground">{a.count} de {a.videoCount}</strong>
                    </span>
                    {a.engagementRate !== null && (
                      <span>
                        Taxa de engajamento:{" "}
                        <strong className="text-foreground">
                          {a.engagementRate.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                        </strong>
                      </span>
                    )}
                    {a.overview?.reach !== null && a.overview?.reach !== undefined && (
                      <span>
                        Alcance (28d): <strong className="text-foreground">{number(a.overview.reach)}</strong>
                      </span>
                    )}
                    {a.mediaCount !== null && (
                      <span>
                        Publicações no perfil: <strong className="text-foreground">{number(a.mediaCount)}</strong>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">
              {rankBy === "likes"
                ? "Top 10 vídeos por curtidas"
                : rankBy === "interactions"
                  ? "Top 10 vídeos por interações"
                  : "Top 10 vídeos por visualizações"}
            </h3>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ordenar ranking de vídeos">
              {(
                [
                  ["views", "Por visualizações"],
                  ["likes", "Por curtidas"],
                  ["interactions", "Por interações"],
                ] as const
              ).map(([key, label]) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={rankBy === key ? "default" : "outline"}
                  onClick={() => setRankBy(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          {!rankedVideos.length ? (
            <div className="space-y-3">
              <p>Nenhum vídeo com visualizações disponíveis nesta seleção.</p>
              {videos.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Vídeos publicados recentemente (curtidas em tempo real; visualizações sendo processadas pela Meta):
                  </p>
                  {videos.slice(0, 10).map((v) => (
                    <div
                      key={`pending-${v.account_id}-${v.id}`}
                      className="flex items-center gap-4 rounded-xl border border-white/10 p-3"
                    >
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
                        <p className="truncate text-sm text-muted-foreground">{v.caption}</p>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          {validCount(v.likes) && <span>{number(v.likes)} curtidas</span>}
                          {validCount(v.comments) && <span>{number(v.comments)} comentários</span>}
                          {v.permalink && /^https:\/\//i.test(v.permalink) && (
                            <a
                              href={v.permalink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                            >
                              Ver no Instagram
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        Aguardando views da Meta…
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <ol className="space-y-3">
              {rankedVideos.slice(0, 10).map((v, i) => (
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
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="block truncate">{name(v.account_id)}</strong>
                      {accountMeta[v.account_id]?.folder && (
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-muted-foreground">
                          {accountMeta[v.account_id].folder}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {v.caption}
                    </p>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {validCount(v.likes) && <span>{number(v.likes)} curtidas</span>}
                      {validCount(v.comments) && <span>{number(v.comments)} comentários</span>}
                      {validCount(v.shares) && <span>{number(v.shares)} compartilhamentos</span>}
                      {validCount(v.saves) && <span>{number(v.saves)} salvos</span>}
                      {v.permalink && /^https:\/\//i.test(v.permalink) && (
                        <a
                          href={v.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          Ver no Instagram
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <strong>
                      {rankBy === "likes" && validCount(v.likes)
                        ? number(v.likes)
                        : rankBy === "interactions" && interactionTotal(v) !== null
                          ? number(interactionTotal(v)!)
                          : validCount(v.views)
                            ? number(v.views)
                            : "—"}
                    </strong>
                    <p className="text-xs text-muted-foreground">
                      {rankBy === "likes"
                        ? "curtidas"
                        : rankBy === "interactions"
                          ? "interações"
                          : "visualizações"}
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
                  <th>Curtidas acumuladas</th>
                  <th>Seguidores</th>
                  <th>Pasta</th>
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
                      <td>
                        {a.likesCount
                          ? number(a.likesTotal)
                          : "—"}
                      </td>
                      <td>
                        {a.followers !== null
                          ? number(a.followers)
                          : "—"}
                      </td>
                      <td>{a.folder || "Sem pasta"}</td>
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
            {" · "}Atualização automática em tempo real a cada 30s. Métricas fornecidas pela Meta podem ter atraso de alguns minutos após a publicação.
          </p>
        </>
      )}
    </section>
  );
}
