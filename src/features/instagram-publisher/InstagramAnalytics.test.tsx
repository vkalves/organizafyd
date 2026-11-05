import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({
  publisherRequest: request,
  listAccounts: async () => [
    { id: "a", username: "alfa" },
    { id: "b", username: "beta" },
  ],
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "owner" } }),
}));
import { InstagramAnalytics } from "./InstagramAnalytics";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const video = (id: string, account_id: string, views: number | null) => ({
  id,
  account_id,
  views,
  caption: `Vídeo ${id}`,
  timestamp: "2026-11-01",
  thumbnail_url: null,
  permalink: null,
});
it("ranks videos across accounts, sums available views and merges additional pages without duplicates", async () => {
  request.mockResolvedValueOnce({
    checked_at: "2026-11-04",
    accounts: [
      {
        account_id: "a",
        complete: false,
        nextCursor: "next",
        videos: [video("1", "a", 100), video("missing", "a", null)],
      },
      { account_id: "b", complete: true, videos: [video("2", "b", 300)] },
    ],
  });
  request.mockResolvedValueOnce({
    checked_at: "2026-11-04",
    accounts: [
      {
        account_id: "a",
        complete: true,
        videos: [video("1", "a", 100), video("3", "a", 600)],
      },
    ],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InstagramAnalytics />
    </QueryClientProvider>,
  );
  const ranking = await screen.findByRole("list");
  expect(within(ranking).getAllByRole("listitem")[0]).toHaveTextContent(
    "@beta",
  );
  expect(screen.getByText("400")).toBeInTheDocument();
  expect(screen.getByText("2/3")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Carregar mais vídeos de todas as contas",
    }),
  );
  await waitFor(() => expect(screen.getByText("1.000")).toBeInTheDocument());
  expect(within(ranking).getAllByRole("listitem")[0]).toHaveTextContent(
    "Vídeo 3",
  );
  expect(screen.getByText("3/4")).toBeInTheDocument();
  expect(request).toHaveBeenLastCalledWith("analytics", {
    account_id: "a",
    after: "next",
  });
});
