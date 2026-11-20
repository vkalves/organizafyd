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
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("invite", { app_id: null }));
});
it("uses the visible private app by default when continuing in this browser", async () => {
  mocks.request.mockImplementation(async action => action === "config" ? { ready: true, platformReady: true, apps: [app] } : { url: "https://example.com/instagram/conectar#invite=fixture" });
  render(<ConnectAccount onConnected={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Conectar conta" }));
  expect(await screen.findByLabelText("App para esta conexão")).toHaveValue("private");
  fireEvent.click(screen.getByRole("button", { name: /Continuar neste navegador/ }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("invite", { app_id: "private" }));
});
it("honors an explicit platform choice even when a private app is active", async () => {
  mocks.request.mockImplementation(async action => action === "config" ? { ready: true, platformReady: true, apps: [app] } : { url: "https://example.com/instagram/conectar#invite=fixture" });
  render(<ConnectAccount onConnected={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Conectar conta" }));
  fireEvent.change(await screen.findByLabelText("App para esta conexão"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: /Continuar neste navegador/ }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("invite", { app_id: null }));
});
it("prefers an owned active app unless the platform is explicitly selected", () => {
  expect(selectConnectionApp([], "", true)).toBeNull();
  expect(selectConnectionApp([app], undefined, true)).toBe(app);
  expect(selectConnectionApp([app], "", true)).toBe(app);
  expect(selectConnectionApp([app], null, true)).toBeNull();
  expect(() => selectConnectionApp([app], null, false)).toThrow("not_configured");
  expect(selectConnectionApp([app], "private", true)).toBe(app);
  expect(selectConnectionApp([app], undefined, false)).toBe(app);
  expect(() => selectConnectionApp([app], "somebody-elses-app", true)).toThrow("app_not_found");
  expect(() => selectConnectionApp([{ ...app, active: false }], "private", true)).toThrow("app_not_found");
  expect(() => selectConnectionApp([], undefined, false)).toThrow("not_configured");
});
it("binds authorization to the explicitly entered Android/Chrome handle", async () => {
  mocks.request.mockImplementation(async action => action === "config" ? { ready: true, platformReady: true, apps: [] } : { url: "https://example.com/instagram/conectar#invite=fixture" });
  render(<ConnectAccount onConnected={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Conectar conta" }));
  const expected = await screen.findByLabelText("Instagram esperado (opcional)");
  fireEvent.change(expected, { target: { value: "@Same.Account" } });
  fireEvent.click(screen.getByRole("button", { name: /Continuar neste navegador/ }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("invite", { app_id: null, expected_username: "same.account" }));
});
it("does not generate a connection link for an invalid expected handle", async () => {
  mocks.request.mockResolvedValue({ ready: true, platformReady: true, apps: [] });
  render(<ConnectAccount onConnected={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Conectar conta" }));
  fireEvent.change(await screen.findByLabelText("Instagram esperado (opcional)"), { target: { value: "not a handle" } });
  fireEvent.click(screen.getByRole("button", { name: /Continuar neste navegador/ }));
  expect(await screen.findByText(/Informe um @ válido/)).toBeInTheDocument();
  expect(mocks.request).not.toHaveBeenCalledWith("invite", expect.anything());
});
it("persists a chosen default and selects it after reopening the dialog", async () => {
  let apps = [app, { ...app, id: "second", name: "Segundo app" }];
  mocks.request.mockImplementation(async (action, values) => {
    if (action === "set_default_app") apps = apps.map(item => ({ ...item, isDefault: item.id === values.id }));
    return action === "invite" ? { url: "https://example.com/invite" } : { ready: true, apps };
  });
  render(<ConnectAccount onConnected={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Conectar conta" }));
  fireEvent.change(await screen.findByLabelText("App para esta conexão"), { target: { value: "second" } });
  fireEvent.click(screen.getByRole("button", { name: "Usar este app como padrão para novas contas" }));
  await screen.findByText("App padrão para novas contas");
  expect(mocks.request).toHaveBeenCalledWith("set_default_app", { id: "second" });
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  fireEvent.click(screen.getByRole("button", { name: "Conectar conta" }));
  expect(await screen.findByLabelText("App para esta conexão")).toHaveValue("second");
  fireEvent.click(screen.getByRole("button", { name: /Continuar neste navegador/ }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("invite", { app_id: "second" }));
});
it("reports a failed save without marking the app as default", async () => {
  mocks.request.mockImplementation(async action => {
    if (action === "set_default_app") throw new Error("Não foi possível salvar.");
    return { ready: true, apps: [app] };
  });
  render(<ConnectAccount onConnected={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Conectar conta" }));
  fireEvent.click(await screen.findByRole("button", { name: "Usar este app como padrão para novas contas" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível salvar.");
  expect(screen.queryByText("App padrão para novas contas")).not.toBeInTheDocument();
});
it("uses the saved active default server-side while honoring explicit selections", () => {
  const preferred = { ...app, id: "preferred", isDefault: true };
  expect(selectConnectionApp([app, preferred], undefined, true)).toBe(preferred);
  expect(selectConnectionApp([app, preferred], app.id, true)).toBe(app);
  expect(selectConnectionApp([app, preferred], null, true)).toBeNull();
  expect(selectConnectionApp([app, { ...preferred, active: false }], undefined, true)).toBe(app);
});
