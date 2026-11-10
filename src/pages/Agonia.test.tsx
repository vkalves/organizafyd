import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
const mocks = vi.hoisted(() => ({ save: vi.fn(), request: vi.fn(), upload: vi.fn() }));
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
vi.mock("@/features/instagram-publisher/useInstagramAnalytics", () => ({ useInstagramAnalytics: () => ({ report: { data: { accounts: [] } }, loadingMore: false, loadMore: vi.fn() }) }));
vi.mock("@/features/instagram-publisher/account-api", () => ({ loadAccountPhotos: vi.fn().mockResolvedValue([]) }));
import Agonia from "./Agonia";
import { loadSettings } from "@/features/agonia/schedule";

const clients: QueryClient[] = [];
function show(section: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/dispara/${section}`]}><Routes>
    <Route path="/dispara/:section" element={<Agonia />} />
    <Route path="/dispara" element={<h1>Dashboard</h1>} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("crypto", webcrypto); localStorage.clear(); mocks.request.mockResolvedValue({}); mocks.upload.mockResolvedValue(["storage://visual-qa/test.mp4"]); mocks.save.mockResolvedValue({}); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });

describe("Avança — controles dos fluxos existentes", () => {
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
    expect(screen.getByRole("link", { name: "Novo Reel" })).toHaveAttribute("href", "/dispara/reels-new");
    expect(screen.getByRole("link", { name: "Novo Story" })).toHaveAttribute("href", "/dispara/stories");
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
