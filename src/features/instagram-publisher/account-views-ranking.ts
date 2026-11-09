import type { AnalyticsReport } from "./useInstagramAnalytics";

type Account = { id: string; username: string; model?: string | null };
export function accountViewsRanking(
  accounts: Account[],
  report: AnalyticsReport | undefined,
  now = Date.now(),
) {
  const reports = new Map(report?.accounts.map((a) => [a.account_id, a]));
  const rows = accounts
    .map((account) => {
      const data = reports.get(account.id);
      const videos = [
        ...new Map(
          (data?.videos ?? [])
            .filter(
              (v) =>
                v.account_id === account.id &&
                Number.isFinite(Date.parse(v.timestamp)) &&
                Date.parse(v.timestamp) <= now,
            )
            .map((v) => [v.id, v]),
        ).values(),
      ];
      const measured = videos.filter(
        (v) =>
          typeof v.views === "number" &&
          Number.isFinite(v.views) &&
          v.views >= 0,
      );
      const available =
        !!data &&
        !data.unavailable &&
        (measured.length > 0 || (data.complete && videos.length === 0));
      const views = available
        ? measured.reduce((sum, v) => sum + (v.views ?? 0), 0)
        : null;
      return {
        ...account,
        views,
        partial:
          !data ||
          data.unavailable ||
          !data.complete ||
          measured.length !== videos.length,
        measuredVideos: measured.length,
      };
    })
    .sort((a, b) =>
      a.views === null
        ? b.views === null
          ? a.username.localeCompare(b.username)
          : 1
        : b.views === null
          ? -1
          : b.views - a.views || a.username.localeCompare(b.username),
    );
  const available = rows.filter(
    (row): row is typeof row & { views: number } => row.views !== null,
  );
  const lowest = available[available.length - 1];
  return {
    rows,
    totalViews: available.length
      ? available.reduce((sum, row) => sum + row.views, 0)
      : null,
    maxViews: Math.max(1, ...available.map((row) => row.views)),
    best: available[0],
    lowest,
    lowestAccounts: available.filter((row) => row.views === lowest?.views),
    partial: rows.some((row) => row.partial),
    hasMore: report?.accounts.some((row) => row.nextCursor) ?? false,
  };
}
