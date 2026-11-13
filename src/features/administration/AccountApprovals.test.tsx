import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountDecision } from "./AccountApprovals";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./api", () => ({ adminRequest: mocks.request }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function mount() {
  const saved = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><AccountDecision user={{ id: "fixture", email: "new@example.test", display_name: "Nova pessoa", is_admin: false, account_status: "pending" }} onSaved={saved} /></QueryClientProvider>);
  return saved;
}
describe("account review actions", () => {
  it("saves approval and refreshes the queue", async () => {
    mocks.request.mockResolvedValue({ ok: true }); const saved = mount();
    fireEvent.click(screen.getByRole("button", { name: "Aprovar conta" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.request).toHaveBeenCalledWith("approve_account", { user_id: "fixture", status: "approved" });
  });
  it("requires confirmation before rejecting and allows cancellation", async () => {
    mocks.request.mockResolvedValue({ ok: true }); mount();
    fireEvent.click(screen.getByRole("button", { name: "Rejeitar conta" }));
    expect(mocks.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("button", { name: "Confirmar rejeição" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rejeitar conta" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar rejeição" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("approve_account", { user_id: "fixture", status: "rejected" }));
  });
  it("keeps the decision unsaved when the server rejects it", async () => {
    mocks.request.mockRejectedValue(new Error("Este cadastro já foi analisado.")); const saved = mount();
    fireEvent.click(screen.getByRole("button", { name: "Aprovar conta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Este cadastro já foi analisado.");
    expect(saved).not.toHaveBeenCalled();
  });
});
