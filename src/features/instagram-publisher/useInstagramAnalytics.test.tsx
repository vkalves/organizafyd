import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const request = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ publisherRequest: request }));
import {
  fetchAnalyticsReport,
  useInstagramAnalytics,
} from "./useInstagramAnalytics";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});
const page = (views: number, cursor?: string) => ({
  checked_at: "2026-11-12",
  accounts: [{
    account_id: "a",
    unavailable: false,
    complete: !cursor,
    nextCursor: cursor,
    videos: [{
      id: "r",
      account_id: "a",
      media_product_type: "REELS",
      views,
      likes: 3,
    }],
  }],
});
it("collects pagination without double-counting and preserves partial pages when Meta fails", async () => {
  request.mockResolvedValueOnce(page(10, "next")).mockResolvedValueOnce(
    page(20),
  );
  expect((await fetchAnalyticsReport(true)).accounts[0]).toMatchObject({
    complete: true,
    videos: [{ id: "r", views: 20 }],
  });
  expect(request).toHaveBeenLastCalledWith("analytics", {
    account_id: "a",
    after: "next",
  });
  request.mockResolvedValueOnce(page(10, "next")).mockRejectedValueOnce(
    new Error("Meta offline"),
  );
  expect((await fetchAnalyticsReport(true)).accounts[0]).toMatchObject({
    complete: false,
    nextCursor: "next",
    videos: [{ views: 10 }],
  });
});
it("refreshes dashboard metrics on the interval and stops when the dashboard is disabled", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  request.mockResolvedValue(page(10));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ enabled }) => useInstagramAnalytics("owner", enabled, 60_000),
    { wrapper, initialProps: { enabled: true } },
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(hook.result.current.report.isSuccess).toBe(true);
  request.mockResolvedValue(page(50));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(request).toHaveBeenCalledTimes(2);
  expect(client.getQueryData(["ig-analytics", "owner"])).toMatchObject({
    accounts: [{ videos: [{ views: 50 }] }],
  });
  hook.rerender({ enabled: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(request).toHaveBeenCalledTimes(2);
  hook.unmount();
  client.clear();
});
it("loads accounts separately with bounded concurrency and isolates a failing account", async () => {
  let active = 0, max = 0;
  request.mockImplementation(
    async (
      action: string,
      values?: { list_only?: boolean; account_id?: string },
    ) => {
      if (values?.list_only) {
        return {
          metadata_only: true,
          checked_at: "now",
          accounts: Array.from(
            { length: 8 },
            (_, i) => ({
              account_id: String(i),
              videos: [],
              complete: false,
              unavailable: false,
            }),
          ),
        };
      }
      active++;
      max = Math.max(max, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      if (values?.account_id === "2") throw new Error("offline");
      return {
        checked_at: "now",
        accounts: [{
          account_id: values?.account_id,
          videos: [],
          complete: true,
          unavailable: false,
        }],
      };
    },
  );
  const result = await fetchAnalyticsReport();
  expect(max).toBe(3);
  expect(
    result.accounts.filter((account) => account.unavailable).map((account) =>
      account.account_id
    ),
  ).toEqual(["2"]);
  expect(result.accounts).toHaveLength(8);
});
it("refreshes recent metrics without rescanning or discarding manually loaded history", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const old = page(5);
  old.accounts[0].videos.push({
    ...old.accounts[0].videos[0],
    id: "older",
    views: 40,
  });
  client.setQueryData(["ig-analytics", "owner"], old, {
    updatedAt: Date.now() - 120000,
  });
  request.mockResolvedValue(page(10, "first-page-cursor"));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useInstagramAnalytics("owner", true, 60_000), {
    wrapper,
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(
    hook.result.current.report.data?.accounts[0].videos.map(
      (video) => [video.id, video.views],
    ),
  ).toEqual([["r", 10], ["older", 40]]);
  expect(hook.result.current.report.data?.accounts[0].complete).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  hook.unmount();
  client.clear();
});
it("explicit refresh consults older pages while interval refresh stays bounded", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  request.mockResolvedValue(page(10));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useInstagramAnalytics("owner", true, 60_000), {
    wrapper,
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(hook.result.current.report.data?.accounts[0].videos[0].views).toBe(10);
  request.mockResolvedValueOnce(page(20, "older")).mockResolvedValueOnce(
    page(30),
  );
  await act(async () => {
    await hook.result.current.refreshMetrics();
  });
  expect(request).toHaveBeenLastCalledWith("analytics", {
    account_id: "a",
    after: "older",
  });
  await waitFor(() => expect(hook.result.current.report.data?.accounts[0]).toMatchObject({
    complete:true,videos:[{views:30}],
  }));
  hook.unmount();
  client.clear();
});
