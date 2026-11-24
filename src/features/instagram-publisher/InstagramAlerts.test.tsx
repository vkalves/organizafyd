import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), warning: vi.fn(), sound: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("./monitor", () => ({ monitorRequest: mocks.request, healthLabels: { unavailable: "Perfil inacessível pela API" } }));
vi.mock("./sound", () => ({ playConfirmation: mocks.sound }));
vi.mock("sonner", () => ({ toast: { warning: mocks.warning } }));
import { InstagramAlerts } from "./InstagramAlerts";
const clients: QueryClient[] = [];
function show() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
 const view = render(<QueryClientProvider client={client}><MemoryRouter><InstagramAlerts /></MemoryRouter></QueryClientProvider>);
 return { ...view, client };
}
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); mocks.request.mockResolvedValue({ health: [], alerts: [{ id: "alert-1", state: "unavailable", read_at: null, resolved_at: null }] }); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });
it("announces a new problem once with sound and keeps it in the notification inbox", async () => {
 const { client, unmount } = show();
 const bell = await screen.findByRole("link", { name: /1 não lidos/ });
 expect(bell).toHaveAttribute("href", "/avanca/alertas");
 expect(mocks.warning).toHaveBeenCalledOnce(); expect(mocks.sound).toHaveBeenCalledWith("alert");
 await act(async () => { await client.invalidateQueries({ queryKey: ["instagram-monitor", "owner"] }); });
 expect(mocks.warning).toHaveBeenCalledOnce(); expect(mocks.sound).toHaveBeenCalledOnce();
 unmount(); show(); await screen.findByRole("link", { name: /1 não lidos/ });
 expect(mocks.warning).toHaveBeenCalledOnce(); expect(mocks.sound).toHaveBeenCalledOnce();
});
it("does not announce read or resolved problems", async () => {
 mocks.request.mockResolvedValue({ health: [], alerts: [{ id: "old", read_at: "today" }, { id: "resolved", resolved_at: "today" }] });
 show(); await waitFor(() => expect(mocks.request).toHaveBeenCalled());
 expect(mocks.warning).not.toHaveBeenCalled(); expect(mocks.sound).not.toHaveBeenCalled();
});

it("deduplicates more than 200 simultaneous problems across remounts", async () => {
 mocks.request.mockResolvedValue({ health: [], alerts: Array.from({length: 250}, (_, i) => ({ id: `alert-${i}`, state: 'unavailable', read_at: null, resolved_at: null })) });
 const {unmount} = show();
 await screen.findByRole('link', {name: /250 não lidos/});
 expect(mocks.warning).toHaveBeenCalledOnce();
 unmount(); show();
 await screen.findByRole('link', {name: /250 não lidos/});
 expect(mocks.warning).toHaveBeenCalledOnce();
});

it("includes exact @username in real-time notifications for single and multiple accounts", async () => {
 mocks.request.mockResolvedValue({
  health: [],
  alerts: [
   { id: "a1", account_id: "1", username: "loja_um", state: "unavailable", read_at: null, resolved_at: null },
   { id: "a2", account_id: "2", username: "loja_dois", state: "unavailable", read_at: null, resolved_at: null },
  ],
 });
 show();
 await screen.findByRole("link", { name: /2 não lidos/ });
 expect(mocks.warning).toHaveBeenCalledWith(
  "2 novas notificações do Instagram",
  expect.objectContaining({
   description: expect.stringContaining("@loja_um (Perfil inacessível pela API), @loja_dois (Perfil inacessível pela API)"),
  }),
 );
});
