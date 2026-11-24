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

function renderAnalytics() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InstagramAnalytics />
    </QueryClientProvider>,
  );
}

it("sums available views across accounts, omits Top 10 videos clutter, and merges additional pages without duplicates", async () => {
  request.mockResolvedValueOnce({
    checked_at: "2026-11-04T12:00:00Z",
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
    checked_at: "2026-11-04T12:01:00Z",
    accounts: [
      {
        account_id: "a",
        complete: true,
        videos: [video("1", "a", 100), video("3", "a", 600)],
      },
    ],
  });

  renderAnalytics();

  expect(await screen.findByText("400")).toBeInTheDocument();
  expect(screen.getByText("2/3 vídeos medidos")).toBeInTheDocument();
  expect(screen.queryByText(/Top 10 vídeos/i)).not.toBeInTheDocument();

  const table = screen.getByRole("table");
  const initialRows = within(table).getAllByRole("row");
  expect(initialRows[1]).toHaveTextContent("@beta");
  expect(initialRows[1]).toHaveTextContent("300");

  fireEvent.click(
    screen.getByRole("button", {
      name: "Carregar mais vídeos de todas as contas",
    }),
  );

  await waitFor(() => expect(screen.getByText("1.000")).toBeInTheDocument());
  expect(screen.getByText("3/4 vídeos medidos")).toBeInTheDocument();
  const updatedRows = within(screen.getByRole("table")).getAllByRole("row");
  expect(updatedRows[1]).toHaveTextContent("@alfa");
  expect(updatedRows[1]).toHaveTextContent("700");
  expect(request).toHaveBeenLastCalledWith("analytics", {
    account_id: "a",
    after: "next",
  });
});

it("filters by account and publication date while preserving genuine zero views", async () => {
  const recent = new Date(Date.now() - 86400000).toISOString();
  const older = new Date(Date.now() - 60 * 86400000).toISOString();
  request.mockResolvedValueOnce({
    checked_at: recent,
    accounts: [
      {
        account_id: "a",
        complete: true,
        videos: [
          { ...video("recent", "a", 0), timestamp: recent },
          { ...video("older", "a", 500), timestamp: older },
          { ...video("missing", "a", null), timestamp: recent },
        ],
      },
      {
        account_id: "b",
        complete: true,
        videos: [{ ...video("beta", "b", 300), timestamp: recent }],
      },
    ],
  });
  renderAnalytics();
  await screen.findByText("800");

  fireEvent.change(screen.getByLabelText("Conta"), { target: { value: "a" } });
  fireEvent.change(screen.getByLabelText("Vídeos publicados"), {
    target: { value: "7" },
  });

  expect(screen.getByText("1/2 vídeos medidos")).toBeInTheDocument();
  const rows = within(screen.getByRole("table")).getAllByRole("row");
  expect(rows).toHaveLength(2);
  expect(within(rows[1]).getAllByRole("cell")[2]).toHaveTextContent("0");
});

it("offers a connection link when there are no connected accounts", async () => {
  request.mockResolvedValueOnce({
    accounts: [],
    checked_at: new Date().toISOString(),
  });
  renderAnalytics();
  expect(
    await screen.findByRole("link", { name: "Conectar conta do Instagram" }),
  ).toHaveAttribute("href", "/avanca/conectar");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("shows a recoverable error instead of fabricated metrics", async () => {
  request.mockRejectedValueOnce(new Error("offline"));
  request.mockResolvedValueOnce({
    accounts: [],
    checked_at: new Date().toISOString(),
  });
  renderAnalytics();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Não foi possível carregar as métricas",
  );
  fireEvent.click(screen.getByRole("button", { name: "Atualizar métricas" }));
  expect(
    await screen.findByRole("link", { name: "Conectar conta do Instagram" }),
  ).toBeInTheDocument();
});

it("marks unavailable accounts without treating missing views as zero", async () => {
  request.mockResolvedValueOnce({
    checked_at: new Date().toISOString(),
    accounts: [
      { account_id: "a", complete: false, unavailable: true, videos: [] },
    ],
  });
  renderAnalytics();
  expect(await screen.findByText("Conta indisponível")).toBeInTheDocument();
  expect(
    within(screen.getByRole("table")).getByText("Indisponível"),
  ).toBeInTheDocument();
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

    expect(await screen.findByText("20.800")).toBeInTheDocument();
    expect(screen.getByText("820")).toBeInTheDocument();
    expect(screen.getByText("+420 nos últimos 28d")).toBeInTheDocument();

    // Filter by folder "Fitness" -> only @alfa remains in table
    fireEvent.change(screen.getByLabelText("Pasta"), {
      target: { value: "Fitness" },
    });
    const filteredRows = within(screen.getByRole("table")).getAllByRole("row");
    expect(filteredRows).toHaveLength(2);
    expect(filteredRows[1]).toHaveTextContent("@alfa");

    // Select all accounts again and toggle individual account chip
    fireEvent.click(screen.getByRole("button", { name: /Todas as contas/ }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3);
    const alfaChip = screen.getByRole("button", { name: "@alfa", pressed: true });
    fireEvent.click(alfaChip);
    const afterToggle = within(screen.getByRole("table")).getAllByRole("row");
    expect(afterToggle).toHaveLength(2);
    expect(afterToggle[1]).toHaveTextContent("@beta");
  });

  it("shows 0 views and 0 likes in the table for healthy accounts with zero videos and Processando while Meta computes views", async () => {
    const slightlyAheadOfClient = new Date(Date.now() + 30_000).toISOString();
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
            followers_count: 0,
            follows_count: 0,
            media_count: 0,
            profile_picture_url: null,
          },
          overview: null,
          videos: [],
        },
        {
          account_id: "b",
          complete: true,
          unavailable: false,
          profile: {
            username: "beta",
            name: "Beta",
            followers_count: 10,
            follows_count: 5,
            media_count: 1,
            profile_picture_url: null,
          },
          overview: null,
          videos: [
            {
              ...video("fresh-reel", "b", null),
              timestamp: slightlyAheadOfClient,
              likes: 7,
              comments: 2,
            },
          ],
        },
      ],
    });
    renderAnalytics();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    // @alfa has 0 videos and complete=true -> views=0, likes=0, status=Concluída (not Indisponível!)
    const alfaRow = rows.find((r) => r.textContent?.includes("@alfa"))!;
    expect(within(alfaRow).getAllByRole("cell")[2]).toHaveTextContent("0");
    expect(within(alfaRow).getAllByRole("cell")[3]).toHaveTextContent("0");
    expect(within(alfaRow).getAllByRole("cell")[5]).toHaveTextContent("Concluída");

    // @beta has a freshly published Reel with real-time likes=7 and views pending -> Processando…
    const betaRow = rows.find((r) => r.textContent?.includes("@beta"))!;
    expect(within(betaRow).getAllByRole("cell")[2]).toHaveTextContent("Processando…");
    expect(within(betaRow).getAllByRole("cell")[3]).toHaveTextContent("7");
  });

  it("shows general followers ranking when no folder is selected and scopes ranking to the selected folder", async () => {
    saveAccountFolders("owner", ["Fitness", "Moda"]);
    saveAccountMeta("owner", {
      a: { model: "M1", folder: "Fitness", dailyTarget: 5, notes: "" },
      b: { model: "M2", folder: "Moda", dailyTarget: 5, notes: "" },
      c: { model: "M3", folder: "Fitness", dailyTarget: 5, notes: "" },
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
            followers_count: 4200,
            follows_count: 100,
            media_count: 10,
            profile_picture_url: null,
          },
          overview: null,
          videos: [],
        },
        {
          account_id: "b",
          complete: true,
          unavailable: false,
          profile: {
            username: "beta",
            name: "Beta",
            followers_count: 19500,
            follows_count: 150,
            media_count: 25,
            profile_picture_url: null,
          },
          overview: null,
          videos: [],
        },
        {
          account_id: "c",
          complete: true,
          unavailable: false,
          profile: {
            username: "gama",
            name: "Gama",
            followers_count: 9100,
            follows_count: 80,
            media_count: 15,
            profile_picture_url: null,
          },
          overview: null,
          videos: [],
        },
      ],
    });
    renderAnalytics();

    const panel = await screen.findByTestId("followers-ranking");
    expect(
      within(panel).getByText("Ranking geral de seguidores"),
    ).toBeInTheDocument();

    let rows = within(panel).getAllByTestId("followers-ranking-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("1º");
    expect(rows[0]).toHaveTextContent("@beta");
    expect(rows[0]).toHaveTextContent("19.500 seguidores");
    expect(rows[1]).toHaveTextContent("2º");
    expect(rows[1]).toHaveTextContent("@gama");
    expect(rows[2]).toHaveTextContent("3º");
    expect(rows[2]).toHaveTextContent("@alfa");

    fireEvent.change(screen.getByLabelText("Pasta"), {
      target: { value: "Fitness" },
    });
    expect(
      within(panel).getByText("Ranking de seguidores · Fitness"),
    ).toBeInTheDocument();
    rows = within(panel).getAllByTestId("followers-ranking-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("1º");
    expect(rows[0]).toHaveTextContent("@gama");
    expect(rows[1]).toHaveTextContent("2º");
    expect(rows[1]).toHaveTextContent("@alfa");
    expect(within(panel).queryByText("@beta")).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "Ranking geral" }));
    expect(
      within(panel).getByText("Ranking geral de seguidores"),
    ).toBeInTheDocument();
    expect(within(panel).getAllByTestId("followers-ranking-row")).toHaveLength(3);
  });
});
