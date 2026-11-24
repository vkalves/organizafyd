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
import { saveAccountFolders, saveAccountMeta } from "@/features/agonia/schedule";
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
  localStorage.clear();
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
  expect(await screen.findByRole("link", { name: "Conectar conta do Instagram" })).toHaveAttribute("href", "/avanca/conectar");
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

describe("Views, likes, followers and folder organization", () => {
  it("displays views, likes, followers, growth and separates accounts by folders", async () => {
    saveAccountFolders("owner", ["Fitness", "Moda"]);
    saveAccountMeta("owner", {
      a: { model: "M1", folder: "Fitness", dailyTarget: 5, notes: "" },
      b: { model: "M2", folder: "Moda", dailyTarget: 5, notes: "" },
    });
    request.mockResolvedValueOnce({
      checked_at: new Date().toISOString(),
      accounts: [
        {
          account_id: "a",
          complete: true,
          unavailable: false,
          profile: {
            username: "alfa",
            name: "Alfa",
            followers_count: 12500,
            follows_count: 200,
            media_count: 45,
            profile_picture_url: null,
          },
          overview: {
            period_days: 28,
            since: "2026-10-15T00:00:00.000Z",
            until: "2026-11-12T00:00:00.000Z",
            views: 50000,
            reach: 30000,
            accounts_engaged: 4000,
            total_interactions: 3500,
            likes: 3000,
            comments: 250,
            shares: 150,
            saves: 100,
            follower_series: [],
            new_followers: 420,
          },
          videos: [
            {
              ...video("v-alfa", "a", 1500),
              likes: 180,
              comments: 20,
              shares: 10,
              saves: 15,
            },
          ],
        },
        {
          account_id: "b",
          complete: true,
          unavailable: false,
          profile: {
            username: "beta",
            name: "Beta",
            followers_count: 8300,
            follows_count: 150,
            media_count: 30,
            profile_picture_url: null,
          },
          overview: null,
          videos: [
            {
              ...video("v-beta", "b", 900),
              likes: 640,
              comments: 5,
            },
          ],
        },
      ],
    });
    renderAnalytics();

    expect(await screen.findByText("Vídeo v-alfa")).toBeInTheDocument();
    // Aggregate followers: 12.500 + 8.300 = 20.800; aggregate likes: 180 + 640 = 820
    expect(screen.getByText("20.800")).toBeInTheDocument();
    expect(screen.getByText("820")).toBeInTheDocument();
    expect(screen.getByText("+420")).toBeInTheDocument();

    // Sort ranking by likes -> v-beta (640 likes) moves to rank #1
    fireEvent.click(screen.getByRole("button", { name: "Por curtidas" }));
    const ranking = screen.getByRole("list");
    expect(within(ranking).getAllByRole("listitem")[0]).toHaveTextContent("Vídeo v-beta");

    // Filter by folder "Fitness" -> only @alfa remains
    fireEvent.change(screen.getByLabelText("Pasta"), { target: { value: "Fitness" } });
    expect(screen.queryByText("Vídeo v-beta")).not.toBeInTheDocument();
    expect(screen.getByText("Vídeo v-alfa")).toBeInTheDocument();
    expect(screen.getAllByText("12.500").length).toBeGreaterThanOrEqual(1);

    // Select all accounts again and toggle individual account chip
    fireEvent.click(screen.getByRole("button", { name: /Todas as contas/ }));
    expect(screen.getByText("Vídeo v-beta")).toBeInTheDocument();
    const alfaChip = screen.getByRole("button", { name: "@alfa", pressed: true });
    fireEvent.click(alfaChip);
    expect(screen.queryByText("Vídeo v-alfa")).not.toBeInTheDocument();
    expect(screen.getByText("Vídeo v-beta")).toBeInTheDocument();
  });
});
