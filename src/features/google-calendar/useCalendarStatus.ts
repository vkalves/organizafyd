import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { calendarRequest, calendarStatusChangedEvent } from "./api";

export function calendarStatusQueryKey(userId?: string) {
  return ["google-calendar", userId];
}

export function useCalendarStatus() {
  const { user } = useAuth();
  const cache = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      void cache.invalidateQueries({ queryKey: calendarStatusQueryKey(user?.id) }, { cancelRefetch: false });
    };
    window.addEventListener(calendarStatusChangedEvent, refresh);
    return () => window.removeEventListener(calendarStatusChangedEvent, refresh);
  }, [cache, user?.id]);

  return useQuery({
    queryKey: calendarStatusQueryKey(user?.id),
    queryFn: () => calendarRequest("status"),
    enabled: Boolean(user),
    retry: false,
    staleTime: 15_000,
    refetchInterval: query => query.state.data?.connected ? 30_000 : false,
  });
}
