import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { SharedFlowProgress } from "./SharedFlowProgress";

const request = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ publisherRequest: request }));
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SharedFlowProgress userId="guest" /></QueryClientProvider>);
}
describe("participant progress panel", () => {
  it("shows the original flow, own account totals and publication history", async () => {
    request.mockResolvedValue([{ flow_id: "flow", flow_name: "Fluxo original", state: "paused", account_id: "mine", username: "meuperfil", counts: { published: 5, scheduled: 2, failed: 1 }, next_at: "2026-11-14T12:00:00Z", recent: [{ id: "job", status: "failed", format: "Reel", scheduled_at: "2026-11-13T12:00:00Z", published_at: null }] }]);
    show();
    expect(await screen.findByText("Fluxo original · @meuperfil")).toBeInTheDocument();
    expect(screen.getByText(/5 publicado\(s\) · 2 na fila/)).toBeInTheDocument();
    expect(screen.getByText(/aguardando retomada/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Ver últimas publicações e agendamentos"));
    expect(screen.getByText("Reel · Falhou")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancelar fluxo/ })).not.toBeInTheDocument();
  });
  it("offers recovery on failure and removes accounts when access is revoked", async () => {
    request.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível atualizar");
    fireEvent.click(screen.getByRole("button", { name: "Atualizar acompanhamento" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText(/Ao participar de um fluxo/)).toBeInTheDocument();
  });
});
