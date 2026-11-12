import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const request = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ publisherRequest: request }));
import { usePublishedReelsToday } from "./usePublishedReelsToday";
import { dayWindow } from "../../../supabase/functions/instagram-publisher/day-window";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
it("resets at local midnight without requiring a page reload or waiting for the refresh interval", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T02:59:50Z"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  request.mockImplementation(async () => {
    const { start, end } = dayWindow("America/Fortaleza");
    return { accounts: [{ account_id: "a", count: start < Date.parse("2026-11-12T03:00:00Z") ? 17 : 0, complete: true, unavailable: false }], timezone: "America/Fortaleza", start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString(), checked_at: new Date().toISOString() };
  });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => usePublishedReelsToday("owner", true, "America/Fortaleza"), { wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(hook.result.current.data?.count).toBe(17);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_100); });
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(hook.result.current.data?.count).toBe(0);
  expect(hook.result.current.data?.start_at).toBe("2026-11-12T03:00:00.000Z");
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenCalledWith("published_today", { timezone: "America/Fortaleza" });
  hook.unmount(); client.clear();
});
