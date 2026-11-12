import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { selectConnectionApp } from "../../../supabase/functions/instagram-login/connection-option";
const mocks = vi.hoisted(() => ({ request: vi.fn(), browser: vi.fn() }));
vi.mock("./login", () => ({ loginRequest: mocks.request }));
vi.mock("./browser-login", () => ({ openBrowserLogin: mocks.browser }));
import { ConnectAccount } from "./ConnectAccount";
const app = { id: "private", active: true, name: "Meu app", configId: "", appId: "123", secretConfigured: true };
beforeEach(() => { vi.clearAllMocks(); mocks.browser.mockImplementation(async create => { await create(); return "popup"; }); });
afterEach(cleanup);
it("connects without registering or selecting a personal app", async () => {
  mocks.request.mockImplementation(async action => action === "config" ? { ready: true, platformReady: true, apps: [] } : { url: "https://example.com/instagram/conectar#invite=fixture" });
  render(<ConnectAccount onConnected={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Conectar conta" }));
  const login = await screen.findByRole("button", { name: /Continuar neste navegador/ });
  await waitFor(() => expect(login).toBeEnabled());
  expect(screen.queryByLabelText("App para esta conexão")).not.toBeInTheDocument();
  fireEvent.click(login);
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("invite", { app_id: "" }));
});
it("defaults to the platform connection even when the user has a private app, keeping it optional", async () => {
  mocks.request.mockImplementation(async action => action === "config" ? { ready: true, platformReady: true, apps: [app] } : { url: "https://example.com/instagram/conectar#invite=fixture" });
  render(<ConnectAccount onConnected={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Conectar conta" }));
  fireEvent.click(await screen.findByText("Usar aplicativo próprio (opcional)"));
  expect(screen.getByLabelText("App para esta conexão")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("App para esta conexão"), { target: { value: "private" } });
  fireEvent.click(screen.getByRole("button", { name: /Continuar neste navegador/ }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("invite", { app_id: "private" }));
});
it("selects only the platform app or an explicitly owned active private app", () => {
  expect(selectConnectionApp([], "", true)).toBeNull();
  expect(selectConnectionApp([app], undefined, true)).toBeNull();
  expect(selectConnectionApp([app], "private", true)).toBe(app);
  expect(selectConnectionApp([app], undefined, false)).toBe(app);
  expect(() => selectConnectionApp([app], "somebody-elses-app", true)).toThrow("app_not_found");
  expect(() => selectConnectionApp([{ ...app, active: false }], "private", true)).toThrow("app_not_found");
  expect(() => selectConnectionApp([], undefined, false)).toThrow("not_configured");
});
