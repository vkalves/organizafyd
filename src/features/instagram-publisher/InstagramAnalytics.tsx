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
  const measured = videos.filter((v): v is VideoMetric & { views: number } =>
    validCount(v.views),
  );
  const likedVideos = videos.filter((v): v is VideoMetric & { likes: number } =>
    validCount(v.likes),
  );

  const summarizeAccount = (a: AccountReport) => {
    const accountVideos = videos.filter((v) => v.account_id === a.account_id);
    const rows = measured.filter((v) => v.account_id === a.account_id);
    const likesRows = accountVideos.filter((v): v is VideoMetric & { likes: number } =>
      validCount(v.likes),
    );
    const viewsTotal = rows.reduce((sum, v) => sum + v.views, 0);
    const likesTotal = likesRows.reduce((sum, v) => sum + v.likes, 0);
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
      followers,
      delta7d: followerDelta(followers, a.followers_history, 7, now),
      delta30d: followerDelta(followers, a.followers_history, 30, now),
      newFollowers28d: validCount(a.overview?.new_followers)
        ? a.overview!.new_followers!
        : null,
    };
  };

  const accountTotals = accounts
    .map(summarizeAccount)
    .sort(
      (a, b) =>
        (b.cardViews ?? -1) - (a.cardViews ?? -1) ||
        (b.cardLikes ?? -1) - (a.cardLikes ?? -1) ||
        (b.followers ?? -1) - (a.followers ?? -1),
    );

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
      return {
        folder: group.folder,
        label: group.label,
        accountIds: group.accounts.map((a) => a.id),
        accountCount: group.accounts.length,
        views: withViews.length
          ? withViews.reduce((s, i) => s + (i.cardViews ?? 0), 0)
          : null,
        likes: withLikes.length
          ? withLikes.reduce((s, i) => s + (i.cardLikes ?? 0), 0)
          : null,
        followers: withFollowers.length
          ? withFollowers.reduce((s, i) => s + (i.followers ?? 0), 0)
          : null,
      };
    });
  }, [allReportAccounts, folderGroups]);

  const selectedRankingFolder = useMemo(() => {
    if (folder !== "*") {
      return { folder, label: folder || "Sem pasta" };
    }
    if (selectedSet !== null && selectedSet.size > 0) {
      const matched = folderSummaries.find(
        (group) =>
          group.accountIds.length > 0 &&
          selectedSet.size === group.accountIds.length &&
          group.accountIds.every((id) => selectedSet.has(id)),
      );
      if (matched) {
        return { folder: matched.folder, label: matched.label };
      }
    }
    return null;
  }, [folder, selectedSet, folderSummaries]);

  const followersRanking = useMemo(() => {
    const scoped = selectedRankingFolder
      ? allReportAccounts.filter((a) => a.folder === selectedRankingFolder.folder)
      : allReportAccounts;
    const rows = [...scoped].sort((a, b) => {
      if (a.followers === null && b.followers === null) {
        return a.account_id.localeCompare(b.account_id);
      }
      if (a.followers === null) return 1;
      if (b.followers === null) return -1;
      if (b.followers !== a.followers) return b.followers - a.followers;
      const growthA = a.newFollowers28d ?? a.delta7d ?? -Infinity;
      const growthB = b.newFollowers28d ?? b.delta7d ?? -Infinity;
      if (growthB !== growthA) return growthB - growthA;
      return a.account_id.localeCompare(b.account_id);
    });
    const measuredRows = rows.filter(
      (r): r is typeof r & { followers: number } => r.followers !== null,
    );
    const totalRankedFollowers = measuredRows.reduce((s, r) => s + r.followers, 0);
    const maxRankedFollowers = Math.max(1, ...measuredRows.map((r) => r.followers));
    return {
      rows,
      totalFollowers: measuredRows.length ? totalRankedFollowers : null,
      maxFollowers: maxRankedFollowers,
    };
  }, [allReportAccounts, selectedRankingFolder]);

  // Executive KPIs across active filtered accounts
  const activeWithViews = accountTotals.filter((a) => a.cardViews !== null);
  const activeWithLikes = accountTotals.filter((a) => a.cardLikes !== null);
  const activeWithFollowers = accountTotals.filter((a) => a.followers !== null);
  const kpiViews = measured.length
    ? measured.reduce((s, v) => s + v.views, 0)
    : activeWithViews.length
      ? activeWithViews.reduce((s, a) => s + (a.cardViews ?? 0), 0)
      : null;
  const kpiLikes = likedVideos.length
    ? likedVideos.reduce((s, v) => s + v.likes, 0)
    : activeWithLikes.length
      ? activeWithLikes.reduce((s, a) => s + (a.cardLikes ?? 0), 0)
      : null;
  const kpiFollowers = activeWithFollowers.length
    ? activeWithFollowers.reduce((s, a) => s + (a.followers ?? 0), 0)
    : null;
  const totalNewFollowers28d = accountTotals.reduce(
    (acc, a) => {
      if (a.newFollowers28d !== null) {
        acc.available = true;
        acc.total += a.newFollowers28d;
      }
      return acc;
    },
    { total: 0, available: false },
  );

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
    const trimmed = newFolderName.trim() || assignFolderName.trim();
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
    <section className="space-y-5" aria-label="Métricas do Instagram">
      {/* Compact filter & sync bar */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-card p-3.5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">
            Vídeos publicados
            <select
              className="mt-1 block h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="all">Todo o histórico</option>
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Pasta
            <select
              className="mt-1 block h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground"
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
          <label className="text-xs text-muted-foreground">
            Conta
            <select
              className="mt-1 block h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground"
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

        <div className="flex flex-wrap items-center gap-2">
          {report.data && (
            <span className="text-xs text-muted-foreground">
              Tempo real (30s) ·{" "}
              {new Date(report.data.checked_at).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          {report.data?.accounts.some((a) => a.nextCursor) && (
            <Button
              size="sm"
              variant="outline"
              disabled={loadingMore || report.isFetching}
              onClick={() => void loadMore()}
            >
              {loadingMore
                ? "Consultando…"
                : "Carregar mais vídeos de todas as contas"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={report.isFetching || loadingMore}
            onClick={() => {
              void names.refetch();
              void refreshMetrics();
            }}
          >
            {report.isFetching ? "Atualizando…" : "Atualizar métricas"}
          </Button>
        </div>
      </div>

      {names.isError && (
        <p role="alert" className="text-xs text-destructive">
          Não foi possível carregar os nomes das contas. Atualize as métricas para tentar novamente.
        </p>
      )}
      <InsightsPermissionNotice report={report.data} accounts={names.data ?? []} />

      {report.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Consultando métricas no Instagram…
        </p>
      ) : report.isError ? (
        <p role="alert" className="rounded-xl border border-border bg-card p-4 text-sm">
          Não foi possível carregar as métricas. Tente atualizar novamente.
        </p>
      ) : !report.data?.accounts.length ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm space-y-2">
          <p>Nenhuma conta do Instagram conectada para analisar.</p>
          <a className="underline text-xs" href="/avanca/conectar">
            Conectar conta do Instagram
          </a>
        </div>
      ) : (
        <>
          {!!accounts.some((a) => !a.complete || a.unavailable) && (
            <p role="status" className="ig-warning text-xs">
              Relatório parcial: há mais publicações para consultar ou contas indisponíveis.
            </p>
          )}

          {/* 4 clean executive KPIs */}
          <div className="ig-pulse">
            <div className="ig-stat">
              <span>Visualizações</span>
              <strong>{kpiViews !== null ? number(kpiViews) : "—"}</strong>
              <small>
                {videos.length > 0
                  ? `${measured.length}/${videos.length} vídeos medidos`
                  : "Nenhum vídeo no período"}
              </small>
            </div>
            <div className="ig-stat">
              <span>Curtidas</span>
              <strong>{kpiLikes !== null ? number(kpiLikes) : "—"}</strong>
              <small>
                {likedVideos.length > 0
                  ? `Média ${number(Math.round((kpiLikes ?? 0) / likedVideos.length))}/vídeo`
                  : "Total acumulado"}
              </small>
            </div>
            <div className="ig-stat">
              <span>Seguidores</span>
              <strong>{kpiFollowers !== null ? number(kpiFollowers) : "—"}</strong>
              <small>
                {totalNewFollowers28d.available
                  ? `${signed(totalNewFollowers28d.total)} nos últimos 28d`
                  : "Total nas contas selecionadas"}
              </small>
            </div>
            <div className="ig-stat">
              <span>Contas ativas</span>
              <strong>
                {accounts.filter((a) => !a.unavailable).length}/{accounts.length}
              </strong>
              <small>
                {selectedRankingFolder
                  ? `Pasta: ${selectedRankingFolder.label}`
                  : "Todas as pastas"}
              </small>
            </div>
          </div>

          {/* Clean folder strip */}
          {folderSummaries.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium">Pastas</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      selectedIds === null && folder === "*" && account === "all"
                        ? "default"
                        : "outline"
                    }
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
                      Limpar ({selectedIds.length})
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {folderSummaries.map((group) => {
                  const isFocused =
                    (selectedIds === null && folder === group.folder) ||
                    (selectedSet !== null &&
                      group.accountIds.length > 0 &&
                      group.accountIds.every((id) => selectedSet.has(id)));
                  return (
                    <div
                      key={group.folder || "__unassigned__"}
                      className={`rounded-lg border p-3 space-y-2 transition-colors ${
                        isFocused
                          ? "border-primary/50 bg-primary/[0.04]"
                          : "border-border bg-background/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className="truncate text-xs font-medium">
                          {group.label}
                        </strong>
                        <Button
                          type="button"
                          size="sm"
                          variant={isFocused ? "default" : "outline"}
                          className="h-7 px-2.5 text-xs"
                          onClick={() =>
                            toggleFolderSelection(group.folder, group.accountIds)
                          }
                        >
                          {isFocused
                            ? "Selecionada"
                            : `Selecionar (${group.accountCount})`}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {group.views !== null ? `${number(group.views)} vis.` : "—"}
                        {" · "}
                        {group.likes !== null ? `${number(group.likes)} curt.` : "—"}
                        {" · "}
                        {group.followers !== null
                          ? `${number(group.followers)} seg.`
                          : "—"}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {group.accountIds.map((id) => {
                          const checked = isAccountActive(id);
                          return (
                            <button
                              key={id}
                              type="button"
                              aria-pressed={checked}
                              onClick={() => toggleIndividualAccount(id)}
                              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                                checked
                                  ? "border-primary/60 bg-primary/15 text-foreground"
                                  : "border-border text-muted-foreground hover:text-foreground"
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

              <details className="text-xs text-muted-foreground pt-1">
                <summary className="cursor-pointer select-none hover:text-foreground">
                  Gerenciar pastas
                </summary>
                <div className="mt-3 flex flex-wrap items-end gap-2.5">
                  <label className="text-xs">
                    Conta para mover
                    <select
                      aria-label="Conta para mover de pasta"
                      className="mt-1 block h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                      value={assignAccountId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setAssignAccountId(id);
                        setAssignFolderName(accountMeta[id]?.folder || "");
                      }}
                    >
                      <option value="">Selecione</option>
                      {knownAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {name(a.id)} ({folderLabel(a.id)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs">
                    Pasta de destino
                    <select
                      aria-label="Pasta existente"
                      className="mt-1 block h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
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
                    Nova pasta
                    <input
                      type="text"
                      placeholder="Nome da pasta"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      className="mt-1 block h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                    />
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={handleCreateOrAssignFolder}
                  >
                    Salvar pasta
                  </Button>
                </div>
              </details>
            </div>
          )}

          {/* Main 2-column grid: Followers Ranking + Clean Account Table */}
          <div className="grid gap-5 xl:grid-cols-12 items-start">
            {/* Left: Followers Ranking */}
            <div
              data-testid="followers-ranking"
              aria-label="Ranking de seguidores"
              className="xl:col-span-5 rounded-xl border border-border bg-card p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-medium">
                    {selectedRankingFolder
                      ? `Ranking de seguidores · ${selectedRankingFolder.label}`
                      : "Ranking geral de seguidores"}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {selectedRankingFolder
                      ? `${followersRanking.rows.length} conta(s) nesta pasta`
                      : `Todas as ${followersRanking.rows.length} conta(s) do site`}
                    {followersRanking.totalFollowers !== null &&
                      ` · ${number(followersRanking.totalFollowers)} seg.`}
                  </p>
                </div>
                {selectedRankingFolder && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={selectAllAccounts}
                  >
                    Ranking geral
                  </Button>
                )}
              </div>

              {!followersRanking.rows.length ? (
                <p className="text-xs text-muted-foreground py-3">
                  Nenhuma conta conectada nesta pasta.
                </p>
              ) : (
                <div className="space-y-2">
                  {(() => {
                    let rankPosition = 0;
                    return followersRanking.rows.map((row) => {
                      const hasFollowers = row.followers !== null;
                      if (hasFollowers) rankPosition += 1;
                      const position = hasFollowers ? rankPosition : null;
                      const pctOfLeader =
                        hasFollowers && row.followers! > 0
                          ? Math.max(
                              4,
                              Math.round(
                                (row.followers! / followersRanking.maxFollowers) * 100,
                              ),
                            )
                          : 0;
                      return (
                        <div
                          key={`followers-rank-${row.account_id}`}
                          data-testid="followers-ranking-row"
                          className="rounded-lg border border-border bg-background/40 p-2.5 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span
                                className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold shrink-0 ${
                                  position === 1
                                    ? "bg-primary text-primary-foreground"
                                    : "border border-border text-muted-foreground"
                                }`}
                              >
                                {position !== null ? `${position}º` : "—"}
                              </span>
                              {row.profile?.profile_picture_url && (
                                <img
                                  src={row.profile.profile_picture_url}
                                  alt=""
                                  aria-hidden="true"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  className="h-7 w-7 rounded-full object-cover shrink-0"
                                />
                              )}
                              <div className="min-w-0">
                                <strong className="block truncate text-xs font-medium">
                                  {name(row.account_id)}
                                </strong>
                                <span className="text-[11px] text-muted-foreground">
                                  {row.folder || "Sem pasta"}
                                  {row.newFollowers28d !== null
                                    ? ` · +${number(row.newFollowers28d)} (28d)`
                                    : row.delta7d !== null
                                      ? ` · ${signed(row.delta7d)} (7d)`
                                      : ""}
                                </span>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              {hasFollowers ? (
                                <strong className="text-xs font-semibold tabular-nums">
                                  {number(row.followers!)}{" "}
                                  {row.followers === 1 ? "seguidor" : "seguidores"}
                                </strong>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  Seguidores indisponíveis
                                </span>
                              )}
                            </div>
                          </div>
                          {hasFollowers && (
                            <div
                              className="h-1 overflow-hidden rounded-full bg-muted"
                              aria-hidden="true"
                            >
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${pctOfLeader}%` }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>

            {/* Right: Single clean Account Metrics table */}
            <div className="xl:col-span-7 rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-medium">Métricas por conta</h2>
                <span className="text-xs text-muted-foreground">
                  {accountTotals.length} conta(s)
                </span>
              </div>

              <div className="ig-table-scroll">
                <table className="ig-table">
                  <thead>
                    <tr>
                      <th>Conta</th>
                      <th>Pasta</th>
                      <th>Visualizações</th>
                      <th>Curtidas</th>
                      <th>Seguidores</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountTotals.map((a) => (
                      <tr key={a.account_id}>
                        <td>
                          <div className="flex items-center gap-2">
                            {a.profile?.profile_picture_url && (
                              <img
                                src={a.profile.profile_picture_url}
                                alt=""
                                aria-hidden="true"
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                className="h-6 w-6 rounded-full object-cover shrink-0"
                              />
                            )}
                            <strong>{name(a.account_id)}</strong>
                          </div>
                        </td>
                        <td className="text-muted-foreground">
                          {a.folder || "Sem pasta"}
                        </td>
                        <td className="tabular-nums">
                          {a.cardViews !== null
                            ? number(a.cardViews)
                            : !a.unavailable &&
                                a.videoCount > 0 &&
                                a.insights_error !== "permission_required"
                              ? "Processando…"
                              : "Indisponível"}
                        </td>
                        <td className="tabular-nums">
                          {a.cardLikes !== null ? number(a.cardLikes) : "—"}
                        </td>
                        <td className="tabular-nums">
                          {a.followers !== null ? number(a.followers) : "—"}
                        </td>
                        <td className="text-muted-foreground">
                          {a.unavailable
                            ? "Conta indisponível"
                            : !a.complete
                              ? "Consulta parcial"
                              : "Concluída"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
