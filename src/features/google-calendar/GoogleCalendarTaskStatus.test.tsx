import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleCalendarTaskStatus } from "./GoogleCalendarTaskStatus";
import type { CalendarStatus } from "./api";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "account-1" } }) }));
vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(), calendarRequest: request }));

let cache: QueryClient;
const baseStatus: CalendarStatus = {
  configured: true, connected: true, reconnectRequired: false,
  calendarId: "primary", calendarSummary: "Pessoal", lastSyncedAt: null,
  pendingCount: 0, syncError: null,
};
beforeEach(() => {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  request.mockReset();
});
afterEach(() => {
  cleanup();
  cache.clear();
});

describe("Task calendar status", () => {
  it.each([
    [{ connected: false }, "Conectar Google Agenda"],
    [{ reconnectRequired: true }, "Reconectar Google Agenda"],
    [{ pendingCount: 2 }, "2 alteração(ões) pendente(s) no Google Agenda"],
    [{ syncError: "sync_failed" }, "Google Agenda: sincronização pendente"],
    [{}, "Google Agenda conectado"],
    [{ lastSyncedAt: "2026-10-14T12:00:00Z" }, "Google Agenda atualizado"],
    [{ configured: false }, "Google Agenda"],
  ])("shows status %s without claiming unsent tasks are synchronized", async (changes, label) => {
    request.mockResolvedValue({ ...baseStatus, ...changes });
    render(<QueryClientProvider client={cache}><MemoryRouter><GoogleCalendarTaskStatus /></MemoryRouter></QueryClientProvider>);
    const link = await screen.findByRole("link", { name: label });
    expect(link).toHaveAttribute("href", "/config");
  });

  it("keeps a configuration link available when the integration is unreachable", async () => {
    request.mockRejectedValue(new Error("private server details"));
    render(<QueryClientProvider client={cache}><MemoryRouter><GoogleCalendarTaskStatus /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole("link", { name: "Google Agenda" })).toHaveAttribute("href", "/config");
    expect(screen.queryByText(/private server details/)).not.toBeInTheDocument();
  });
});
