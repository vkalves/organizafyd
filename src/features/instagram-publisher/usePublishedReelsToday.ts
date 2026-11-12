import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { publisherRequest } from "./api";
import { dayWindow } from "../../../supabase/functions/instagram-publisher/day-window";
import type { PublishedTodayReport } from "../../../supabase/functions/instagram-publisher/published-today";

export function publishedReelsTotal(report?: PublishedTodayReport) {
  if (!report) return { count: null, partial: false };
  const available = report.accounts.filter(a => !a.unavailable && typeof a.count === "number");
  return {
    count: available.length || !report.accounts.length ? available.reduce((sum, a) => sum + a.count!, 0) : null,
    partial: report.accounts.some(a => a.unavailable || !a.complete),
  };
}

export function usePublishedReelsToday(userId: string | undefined, enabled: boolean, timezone: string) {
  const [clock, setClock] = useState(Date.now);
  const { start, end } = dayWindow(timezone, clock);
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.max(1, end - Date.now() + 10));
    return () => clearTimeout(timer);
  }, [enabled, end]);
  return useQuery({
    queryKey: ["ig-published-today", userId, timezone, start],
    queryFn: () => publisherRequest<PublishedTodayReport>("published_today", { timezone }),
    enabled: !!userId && enabled,
    staleTime: 20_000,
    refetchInterval: enabled ? 20_000 : false,
    retry: false,
    select: report => ({ ...report, ...publishedReelsTotal(report) }),
  });
}
