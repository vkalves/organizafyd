import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleCalendarSettings } from "./GoogleCalendarSettings";
import type { CalendarAction, CalendarStatus } from "./api";

const mocks = vi.hoisted(() => ({ request: vi.fn(), auth: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: mocks.auth }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(), calendarRequest: mocks.request }));

const defaultStatus: CalendarStatus = {
  configured: true,
  connected: true,
  reconnectRequired: false,
  calendarId: "primary",
  calendarSummary: "Pessoal",
  lastSyncedAt: null,
  pendingCount: 2,
  syncError: null,
};
let currentStatus: CalendarStatus;
let cache: QueryClient;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}{location.hash}</output>;
}

function createApp(path = "/config") {
  return <QueryClientProvider client={cache}>
    <MemoryRouter initialEntries={[path]}>
      <GoogleCalendarSettings />
      <LocationProbe />
    </MemoryRouter>
  </QueryClientProvider>;
}

beforeEach(() => {
  currentStatus = { ...defaultStatus };
  cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mocks.request.mockReset();
  mocks.auth.mockReturnValue({ user: { id: "account-1" } });
  mocks.success.mockReset();
  mocks.error.mockReset();
  mocks.request.mockImplementation(async (action: CalendarAction, payload?: { calendarId: string }) => {
    if (action === "status") return { ...currentStatus };
    if (action === "calendars") return { calendars: [{ id: "primary", summary: "Pessoal", primary: true }, { id: "work", summary: "Trabalho" }] };
    if (action === "sync") return { connected: true, synced: 2, pending: 0, errors: 0, reconnectRequired: false };
    if (action === "callback") return { connected: true };
    if (action === "select_calendar") currentStatus = { ...currentStatus, calendarId: payload!.calendarId, calendarSummary: "Trabalho" };
    if (action === "disconnect") currentStatus = { ...currentStatus, connected: false, calendarId: null, calendarSummary: null };
    return { success: true };
  });
});

afterEach(() => {
  cleanup();
  cache.clear();
  window.history.replaceState(null, "", "/");
});

describe("Google Agenda settings", () => {
  it("explains the task workflow and shows connection, calendar and pending status", async () => {
    render(createApp());
    expect(await screen.findByText("Conectado")).toBeInTheDocument();
    expect(screen.getByText(/tarefas sem data não são enviadas/)).toBeInTheDocument();
    expect(screen.getByText(/Alterações feitas no Google Agenda não atualizam/)).toBeInTheDocument();
    expect(screen.getByText("2 alteração(ões) aguardando sincronização.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Agenda para suas tarefas")).toHaveValue("primary"));
  });

  it("keeps configuration details out of the unavailable UI", async () => {
    currentStatus.configured = false;
    render(createApp());
    expect(await screen.findByText("Integração indisponível no momento. Tente novamente mais tarde.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Conectar Google Agenda" })).not.toBeInTheDocument();
    expect(mocks.request).not.toHaveBeenCalledWith("calendars");
  });

  it("moves to a selected writable calendar only after saving", async () => {
    render(createApp());
    const select = await screen.findByLabelText("Agenda para suas tarefas");
    await waitFor(() => expect(screen.getByRole("option", { name: "Trabalho" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "work" } });
    expect(mocks.request).not.toHaveBeenCalledWith("select_calendar", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Salvar agenda" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("select_calendar", { calendarId: "work" }));
    expect(await screen.findByText("Trabalho", { selector: "span" })).toBeInTheDocument();
  });

  it("reports partial synchronization accurately and prevents simultaneous actions", async () => {
    let finish!: (result: unknown) => void;
    const previousImplementation = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((action, payload) => action === "sync" ? new Promise(resolve => { finish = resolve; }) : previousImplementation(action, payload));
    render(createApp());
    const sync = await screen.findByRole("button", { name: "Sincronizar agora" });
    fireEvent.click(sync);
    expect(screen.getByRole("button", { name: "Sincronizando…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Desconectar Google Agenda" })).toBeDisabled();
    fireEvent.click(sync);
    expect(mocks.request.mock.calls.filter(([action]) => action === "sync")).toHaveLength(1);
    finish({ connected: true, synced: 1, pending: 1, errors: 1, reconnectRequired: false });
    expect(await screen.findByText("1 alteração(ões) sincronizada(s), 1 pendente(s) e 1 erro(s).")).toBeInTheDocument();
  });

  it("warns that existing events remain and disconnects without deleting them", async () => {
    render(createApp());
    const disconnect = await screen.findByRole("button", { name: "Desconectar Google Agenda" });
    expect(screen.getByText(/Os eventos já criados permanecem no Google Agenda/)).toBeInTheDocument();
    fireEvent.click(disconnect);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("disconnect"));
    expect(await screen.findByRole("button", { name: "Conectar Google Agenda" })).toBeInTheDocument();
  });

  it("does not expose server error details, and requests reconnection when necessary", async () => {
    currentStatus = { ...currentStatus, reconnectRequired: true, syncError: "refresh_token=hidden" };
    render(createApp());
    expect(await screen.findByRole("button", { name: "Reconectar Google Agenda" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sincronizar agora" })).toBeDisabled();
    expect(screen.queryByText(/refresh_token/)).not.toBeInTheDocument();
    expect(screen.getByText(/Algumas alterações ainda não foram sincronizadas/)).toBeInTheDocument();
  });

  it("exchanges callback data only while authenticated and removes it before the exchange", async () => {
    mocks.auth.mockReturnValue({ user: null });
    const callbackPath = "/config?tab=account&google_calendar=callback#calendar&section=calendar&google_calendar_code=temporary-code&google_calendar_state=bound-state";
    const view = render(createApp(callbackPath));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/config?tab=account#calendar&section=calendar"));
    expect(window.location.href).not.toContain("temporary-code");
    expect(mocks.request).not.toHaveBeenCalledWith("callback", expect.anything());
    const implementation = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((action, payload) => {
      if (action === "callback") {
        expect(window.location.hash).not.toContain("google_calendar_code");
        expect(screen.getByTestId("location")).not.toHaveTextContent("bound-state");
      }
      return implementation(action, payload);
    });
    mocks.auth.mockReturnValue({ user: { id: "account-1" } });
    view.rerender(createApp(callbackPath));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("callback", { code: "temporary-code", state: "bound-state" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("Google Agenda conectado."));
    expect(mocks.request.mock.calls.filter(([action]) => action === "callback")).toHaveLength(1);
  });

  it("handles failed authorization once and preserves other query parameters and the hash", async () => {
    render(createApp("/config?tab=account&google_calendar=error#calendar"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/config?tab=account#calendar"));
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.error).toHaveBeenCalledWith("Não foi possível conectar o Google Agenda. Tente novamente.");
  });

  it("clears account-specific status when the authenticated user changes", async () => {
    const view = render(createApp());
    expect(await screen.findByText("Conectado")).toBeInTheDocument();
    mocks.auth.mockReturnValue({ user: { id: "account-2" } });
    mocks.request.mockImplementation(async action => {
      if (action === "status") return { ...defaultStatus, connected: false, calendarId: null, calendarSummary: null };
      return { success: true };
    });
    view.rerender(createApp());
    expect(await screen.findByRole("button", { name: "Conectar Google Agenda" })).toBeInTheDocument();
    expect(screen.queryByText("Pessoal", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.queryByText("Conectado")).not.toBeInTheDocument();
  });

  it("ignores a previous account's synchronization result after the user changes", async () => {
    let finish!: (result: unknown) => void;
    const previousImplementation = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((action, payload) => action === "sync" ? new Promise(resolve => { finish = resolve; }) : previousImplementation(action, payload));
    const view = render(createApp());
    fireEvent.click(await screen.findByRole("button", { name: "Sincronizar agora" }));
    mocks.auth.mockReturnValue({ user: { id: "account-2" } });
    currentStatus = { ...defaultStatus, connected: false, calendarId: null, calendarSummary: null };
    view.rerender(createApp());
    expect(await screen.findByRole("button", { name: "Conectar Google Agenda" })).toBeInTheDocument();
    await act(async () => finish({ connected: true, synced: 99, pending: 0, errors: 0, reconnectRequired: false }));
    expect(screen.queryByText(/99 alteração/)).not.toBeInTheDocument();
  });

  it("does not report a previous account's OAuth connection after the user changes", async () => {
    let finish!: (result: unknown) => void;
    const previousImplementation = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((action, payload) => action === "callback" ? new Promise(resolve => { finish = resolve; }) : previousImplementation(action, payload));
    const callbackPath = "/config?google_calendar=callback#google_calendar_code=temporary-code&google_calendar_state=bound-state";
    const view = render(createApp(callbackPath));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("callback", expect.anything()));
    mocks.auth.mockReturnValue({ user: { id: "account-2" } });
    currentStatus = { ...defaultStatus, connected: false, calendarId: null, calendarSummary: null };
    view.rerender(createApp(callbackPath));
    expect(await screen.findByRole("button", { name: "Conectar Google Agenda" })).toBeInTheDocument();
    await act(async () => finish({ connected: true }));
    expect(mocks.success).not.toHaveBeenCalledWith("Google Agenda conectado.");
  });
});
