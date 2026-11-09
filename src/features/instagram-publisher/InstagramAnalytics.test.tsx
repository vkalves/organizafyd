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

function renderAnalytics() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <InstagramAnalytics />
    </QueryClientProvider>,
  );
}

it("filters by account and publication date while preserving genuine zero views", async () => {
  const recent = new Date(Date.now() - 86400000).toISOString();
  const older = new Date(Date.now() - 60 * 86400000).toISOString();
  request.mockResolvedValueOnce({
    checked_at: recent,
    accounts: [
      { account_id: "a", complete: true, videos: [
        { ...video("recent", "a", 0), timestamp: recent },
        { ...video("older", "a", 500), timestamp: older },
        { ...video("missing", "a", null), timestamp: recent },
      ] },
      { account_id: "b", complete: true, videos: [{ ...video("beta", "b", 300), timestamp: recent }] },
    ],
  });
  renderAnalytics();
  await screen.findByText("Vídeo older");
  fireEvent.change(screen.getByLabelText("Conta"), { target: { value: "a" } });
  fireEvent.change(screen.getByLabelText("Vídeos publicados"), { target: { value: "7" } });
  expect(screen.queryByText("Vídeo older")).not.toBeInTheDocument();
  expect(screen.queryByText("Vídeo beta")).not.toBeInTheDocument();
  expect(screen.getByText("Vídeo recent")).toBeInTheDocument();
  expect(screen.getByText("1/2")).toBeInTheDocument();
  const row = within(screen.getByRole("table")).getAllByRole("row")[1];
  expect(within(row).getAllByRole("cell")[1]).toHaveTextContent("0");
});

it("offers a connection link when there are no connected accounts", async () => {
  request.mockResolvedValueOnce({ accounts: [], checked_at: new Date().toISOString() });
  renderAnalytics();
  expect(await screen.findByRole("link", { name: "Conectar conta do Instagram" })).toHaveAttribute("href", "/disparo/conectar");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("shows a recoverable error instead of fabricated metrics", async () => {
  request.mockRejectedValueOnce(new Error("offline"));
  request.mockResolvedValueOnce({ accounts: [], checked_at: new Date().toISOString() });
  renderAnalytics();
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar as métricas");
  fireEvent.click(screen.getByRole("button", { name: "Atualizar métricas" }));
  expect(await screen.findByRole("link", { name: "Conectar conta do Instagram" })).toBeInTheDocument();
});

it("marks unavailable accounts without treating missing views as zero", async () => {
  request.mockResolvedValueOnce({
    checked_at: new Date().toISOString(),
    accounts: [{ account_id: "a", complete: false, unavailable: true, videos: [] }],
  });
  renderAnalytics();
  expect(await screen.findByText("Conta indisponível")).toBeInTheDocument();
  expect(within(screen.getByRole("table")).getByText("Indisponível")).toBeInTheDocument();
  expect(screen.getByText(/Relatório parcial:/)).toBeInTheDocument();
});
