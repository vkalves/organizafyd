import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
const mocks = vi.hoisted(() => ({ save: vi.fn(), request: vi.fn(), upload: vi.fn(), analytics: vi.fn(), publishedToday: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "visual-qa", email: "qa@example.test", user_metadata: { display_name: "Teste" } }, signOut: vi.fn() }) }));
vi.mock("@/features/instagram-publisher/api", async importOriginal => ({
  ...await importOriginal<typeof import("@/features/instagram-publisher/api")>(),
  listAccounts: vi.fn().mockResolvedValue([{ id: "a", user_id: "visual-qa", username: "conta_teste" }]),
  connections: vi.fn().mockResolvedValue([{ account_id: "a", paused: false, reconnect_required: false }]),
  listPosts: vi.fn().mockResolvedValue([]), savePost: mocks.save, publisherRequest: mocks.request, uploadMedia: mocks.upload,
}));
vi.mock("@/features/instagram-publisher/flows-api", async importOriginal => ({
  ...await importOriginal<typeof import("@/features/instagram-publisher/flows-api")>(),
  loadFlowData: vi.fn().mockResolvedValue({ media: [], flows: [], prefs: { folders: [], captions: [] }, report: { flows: [], usage: [] } }),
}));
vi.mock("@/features/instagram-publisher/InstagramAlerts", () => ({ useInstagramMonitor: () => ({ data: { alerts: [], health: [] } }), InstagramAlerts: () => null }));
vi.mock("@/features/instagram-publisher/useInstagramAnalytics", () => ({ useInstagramAnalytics: (...args: unknown[]) => mocks.analytics(...args) }));
vi.mock("@/features/instagram-publisher/usePublishedReelsToday", () => ({ usePublishedReelsToday: (...args: unknown[]) => mocks.publishedToday(...args) }));
vi.mock("@/features/instagram-publisher/account-api", () => ({ loadAccountPhotos: vi.fn().mockResolvedValue([]) }));
import Agonia from "./Agonia";
import { loadSettings } from "@/features/agonia/schedule";
import { listPosts } from "@/features/instagram-publisher/api";
import type { Post } from "@/features/instagram-publisher/model";

const clients: QueryClient[] = [];
function show(section: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/avanca/${section}`]}><Routes>
    <Route path="/avanca/:section" element={<Agonia />} />
    <Route path="/avanca" element={<h1>Dashboard</h1>} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); mocks.publishedToday.mockReturnValue({ data: { count: 0, partial: false } }); mocks.analytics.mockReturnValue({ report: { data: { accounts: [] } }, loadingMore: false, loadMore: vi.fn() }); vi.stubGlobal("crypto", webcrypto); localStorage.clear(); mocks.request.mockResolvedValue({}); mocks.upload.mockResolvedValue(["storage://visual-qa/test.mp4"]); mocks.save.mockResolvedValue({}); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });

describe("Avança — controles dos fluxos existentes", () => {
  it("usa o total de Reels do Instagram, independentemente da lista de publicações do site", async () => {
    mocks.publishedToday.mockReturnValue({ data: { count: 27, partial: false } });
    show("dashboard");
    expect(await screen.findByLabelText("Reels publicados hoje")).toHaveTextContent("27");
    expect(mocks.publishedToday).toHaveBeenCalledWith("visual-qa", true, "America/Sao_Paulo");
  });
  it("não apresenta uma consulta indisponível como zero publicações", () => {
    mocks.publishedToday.mockReturnValue({ isError: true });
    show("dashboard");
    expect(screen.getByLabelText("Reels publicados hoje")).toHaveTextContent("—");
    expect(screen.getByText("Falha ao atualizar")).toBeInTheDocument();
  });
  it("preenche os dois cards existentes somente com métricas de Reels da API", async () => {
    mocks.analytics.mockReturnValue({ report: { data: { accounts: [{ account_id: "a", complete: true, unavailable: false, videos: [
      { id: "r", account_id: "a", media_product_type: "REELS", views: 1234, likes: 56, timestamp: "2026-11-01" },
      { id: "feed", account_id: "a", media_product_type: "FEED", views: 9999, likes: 9999, timestamp: "2026-11-01" },
    ] }] } }, loadingMore: false, loadMore: vi.fn() });
    show("dashboard");
    await waitFor(() => expect(screen.getByLabelText("Visualizações de Reels")).toHaveTextContent("1.234"));
    expect(screen.getByLabelText("Curtidas de Reels")).toHaveTextContent("56");
    expect(document.querySelectorAll(".stats-grid .stat-card")).toHaveLength(6);
    expect(mocks.analytics).toHaveBeenCalledWith("visual-qa", true, 60_000);
  });
  it("exibe a fila real e altera o resumo de publicações ao selecionar o período", async () => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12).toISOString();
    const post: Post = {
      id: "published", user_id: "visual-qa", account_id: "a", caption: "Publicação anterior",
      format: "Reel", media_urls: [], scheduled_at: null, status: "published",
      created_at: yesterday, updated_at: yesterday, published_at: yesterday,
    };
    vi.mocked(listPosts).mockResolvedValueOnce([post, {
      ...post, id: "queued", caption: "Reel agendado para amanhã", status: "scheduled", published_at: null, scheduled_at: tomorrow,
    }]);
    show("dashboard");
    expect(await screen.findByText("Reel agendado para amanhã")).toBeInTheDocument();
    expect(screen.getByText("Publicações concluídas · Hoje")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Ontem" }));
    const summary = screen.getByRole("heading", { name: "Resumo de desempenho" }).closest("section")!;
    expect(within(summary).getByText("Publicações concluídas · Ontem")).toBeInTheDocument();
    expect(within(summary).getAllByText("1")).toHaveLength(2);
  });
  it("envia mídia, legenda, conta e horário revisados ao contrato de agendamento", async () => {
    show("reels-new");
    await screen.findByText("@conta_teste");
    const file = new File(["test media"], "teste.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText(/Vídeos obrigatório/), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText(/Legenda principal/), { target: { value: "Publicação de teste" } });
    fireEvent.change(screen.getByLabelText("Quando publicar"), { target: { value: "schedule" } });
    fireEvent.change(screen.getByLabelText("Timezone"), { target: { value: "America/Sao_Paulo" } });
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2030-01-10T12:00" } });
    expect(screen.getByRole("checkbox", { name: /conta_teste/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Agendar Reel" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Agendar Reel" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "visual-qa", account_id: "a", format: "Reel", caption: "Publicação de teste",
      media_urls: ["storage://visual-qa/test.mp4"], scheduled_at: "2030-01-10T15:00:00.000Z", status: "scheduled",
    })));
    expect(mocks.upload).toHaveBeenCalledWith([file], "visual-qa", expect.any(Function));
    await screen.findByRole("heading", { name: "Agendamentos" });
  });
  it("mantém os quatro modos do Reel, campos condicionais e bloqueio sem mídia", async () => {
    show("reels-new");
    await screen.findByText("@conta_teste");
    const mode = screen.getByLabelText("Quando publicar");
    expect(within(mode).getAllByRole("option").map(option => option.getAttribute("value"))).toEqual(["sequence", "schedule", "now", "repeat"]);
    fireEvent.change(mode, { target: { value: "schedule" } });
    expect(screen.getByLabelText("Data e hora")).toHaveAttribute("type", "datetime-local");
    expect(screen.getByRole("button", { name: "Agendar Reel" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Legenda principal/), { target: { value: "Legenda preservada" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /conta_teste/ }));
    fireEvent.change(mode, { target: { value: "repeat" } });
    expect(screen.getByLabelText("Quantas vezes repetir o vídeo")).toHaveAttribute("max", "20");
    expect(screen.getByLabelText(/Legenda principal/)).toHaveValue("Legenda preservada");
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("mantém filtros da fila, ações de criação e estado vazio", async () => {
    show("scheduled");
    await waitFor(() => expect(within(screen.getByLabelText("Conta")).getAllByRole("option")).toHaveLength(2));
    expect(screen.getByLabelText("App Meta")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Conta"), { target: { value: "a" } });
    expect(screen.getByLabelText("Conta")).toHaveValue("a");
    expect(screen.getByRole("link", { name: "Novo Reel" })).toHaveAttribute("href", "/avanca/reels-new");
    expect(screen.getByRole("link", { name: "Novo Story" })).toHaveAttribute("href", "/avanca/stories");
    expect(screen.getByRole("button", { name: "Apagar registros" })).toBeDisabled();
  });
  it("salva configurações pela mesma persistência e recupera os valores", async () => {
    show("settings");
    fireEvent.change(screen.getByLabelText("Intervalo padrão entre posts (minutos)"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Legenda padrão dos Reels"), { target: { value: "Minha legenda" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar configurações" }));
    await waitFor(() => expect(loadSettings("visual-qa")).toMatchObject({ intervalMinutes: 30, defaultCaption: "Minha legenda" }));
  });
});
