import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), browser: vi.fn() }));
vi.mock("@/features/instagram-publisher/login", () => ({ loginRequest: mocks.request }));
vi.mock("@/features/instagram-publisher/browser-login", () => ({ openBrowserLogin: mocks.browser }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
import MetaDeveloper from "./MetaDeveloper";
const callback = "https://project.supabase.co/functions/v1/instagram-login";
const app = { id: "app-one", name: "Instagram 01", appId: "123456", configId: "", active: true, createdAt: "", accountCount: 3, secretConfigured: true };
function show() {return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><MetaDeveloper onConnected={vi.fn()} /></QueryClientProvider></MemoryRouter>);}
beforeEach(() => {
 vi.clearAllMocks(); mocks.request.mockResolvedValue({ apps: [app], ready: true, callback });
 mocks.browser.mockImplementation(async fn => { await fn(); return "popup"; });
});
it("matches the reference layout with private apps, optional Config ID, real counts and callbacks", async () => {
 show(); await screen.findByText("App ID:");
 expect(screen.getByRole("heading", { name: "Apps Meta Developer" })).toBeVisible();
 expect(screen.getByRole("button", { name: "Adicionar app Meta" })).toBeVisible();
 expect(screen.getByText("3 contas")).toBeVisible();
 expect(screen.getByLabelText("Callback do Instagram Login")).toHaveValue(callback);
 expect(screen.getByLabelText(/Config ID/)).not.toBeRequired();
 expect(screen.getByText("instagram_basic")).toBeVisible();
});
it("connects using the selected app and updates permissions for unified login", async () => {
 const fb = { ...app, id: "app-two", name: "Business 02", configId: "987654" };
 mocks.request.mockImplementation(async action => action === "invite" ? { url: "https://example.com/invite" } : { apps: [app, fb], ready: true, callback });
 show(); await screen.findByText("Business 02", { selector: "strong" });
 fireEvent.change(screen.getByLabelText("App para esta conexão"), { target: { value: "app-two" } });
 expect(screen.getByText("instagram_basic")).toBeVisible();
 fireEvent.click(screen.getByRole("button", { name: "Conectar pelo Instagram" }));
 await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledWith("invite", { app_id: "app-two" }));
});
it("uses server state for toggles and offers editing", async () => {
 show(); await screen.findByText("App ID:");
 mocks.request.mockResolvedValue({ apps: [{ ...app, active: false }], ready: false, callback });
 fireEvent.click(screen.getByRole("button", { name: "Desativar" }));
 await screen.findByRole("button", { name: "Ativar" });
 expect(screen.getByRole("button", { name: "Conectar pelo Instagram" })).toBeDisabled();
 expect(mocks.request).toHaveBeenCalledWith("toggle_app", { id: app.id });
 fireEvent.click(screen.getByRole("button", { name: "Editar Config ID" }));
 expect(screen.getByRole("heading", { name: "Editar Instagram 01" })).toBeVisible();
});
it("requires explicit deletion and reports backend protection for linked accounts", async () => {
 show(); await screen.findByText("App ID:");
 fireEvent.click(screen.getByRole("button", { name: "Excluir Instagram 01" }));
 expect(mocks.request).not.toHaveBeenCalledWith("delete_app", expect.anything());
 mocks.request.mockRejectedValue(new Error("App tem contas vinculadas"));
 fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
 await screen.findByText("App tem contas vinculadas");
 expect(mocks.request).toHaveBeenCalledWith("delete_app", { id: app.id });
});
it("handles empty and failed lists without inventing credentials", async () => {
 mocks.request.mockRejectedValueOnce(new Error("offline")); show();
 await screen.findByText("Não foi possível consultar seus apps.");
 expect(screen.getByRole("button", { name: "Conectar pelo Instagram" })).toBeDisabled();
 mocks.request.mockResolvedValue({ apps: [], ready: false, callback });
 fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
 await screen.findByText("Seu primeiro app começa aqui");
 expect(screen.getByRole("button", { name: "Adicionar app Meta" })).toBeVisible();
});
it("reports clipboard failure without claiming the callback was copied", async () => {
 Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
 show(); await screen.findByText("App ID:");
 fireEvent.click(screen.getByRole("button", { name: "Copiar Callback do Instagram Login" }));
 await screen.findByText(/Não foi possível copiar/);
 expect(screen.queryByText("Endereço de retorno copiado.")).not.toBeInTheDocument();
});
