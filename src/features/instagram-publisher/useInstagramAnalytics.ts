import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { publisherRequest } from "./api";
import type { VideoMetric } from "../../../supabase/functions/instagram-publisher/analytics";

export type AnalyticsReport = {
  accounts: {
    account_id: string;
    videos: VideoMetric[];
    complete: boolean;
    nextCursor?: string | null;
    unavailable: boolean;
  }[];
  checked_at: string;
};

export async function fetchAnalyticsReport(allPages = false): Promise<AnalyticsReport> {
  const report = await publisherRequest<AnalyticsReport>("analytics");
  if (!allPages) return report;
  // Bound API work for large histories and preserve a cursor for manual continuation.
  for (const account of report.accounts) {
    const seen = new Set<string>();
    for (let page = 0; page < 10 && account.nextCursor; page++) {
      const cursor = account.nextCursor;
      if (seen.has(cursor)) break;
      seen.add(cursor);
      try {
        const next = await publisherRequest<AnalyticsReport>("analytics", { account_id: account.account_id, after: cursor });
        const data = next.accounts.find(a => a.account_id === account.account_id);
        if (!data || data.unavailable) break;
        account.videos = [...new Map([...account.videos, ...data.videos].map(v => [v.id, v])).values()];
        account.complete = data.complete;
        account.nextCursor = data.nextCursor;
      } catch { break; } // Keep the successful pages and report an incomplete total.
    }
  }
  return report;
}

export function useInstagramAnalytics(
  userId: string | undefined,
  enabled = true,
  refreshInterval?: number,
) {
  const cache = useQueryClient();
  const [loadingMore, setLoadingMore] = useState(false);
  const report = useQuery({
    queryKey: ["ig-analytics", userId],
    queryFn: () => fetchAnalyticsReport(!!refreshInterval),
    enabled: !!userId && enabled,
    staleTime: refreshInterval ?? 300000,
    refetchInterval: enabled ? refreshInterval : false,
    retry: false,
  });
  async function loadMore() {
    if (!report.data || loadingMore || !userId) return;
    setLoadingMore(true);
    try {
      for (const current of report.data.accounts.filter((a) => a.nextCursor)) {
        const next = await publisherRequest<AnalyticsReport>("analytics", {
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
        cache.setQueryData<AnalyticsReport>(
          ["ig-analytics", userId],
          (previous) =>
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
                              [...a.videos, ...page.videos].map((v) => [
                                v.id,
                                v,
                              ]),
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
  return { report, loadingMore, loadMore };
}
