import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
import { calendarRequest, calendarStatusChangedEvent, isGoogleCalendarOAuthUrl, requestTaskCalendarSync } from "./api";

const status = {
  configured: true,
  connected: true,
  reconnectRequired: false,
  calendarId: "primary",
  calendarSummary: "Pessoal",
  lastSyncedAt: null,
  pendingCount: 1,
  syncError: null,
};

beforeEach(() => invoke.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("Google Agenda API", () => {
  it("uses the authenticated Supabase function for selecting a calendar", async () => {
    invoke.mockResolvedValue({ data: { success: true }, error: null });
    await calendarRequest("select_calendar", { calendarId: "personal-calendar" });
    expect(invoke).toHaveBeenCalledWith("google-calendar", { body: { action: "select_calendar", calendarId: "personal-calendar" } });
  });

  it("returns validated status and exchanges the callback through the authenticated function", async () => {
    invoke.mockResolvedValueOnce({ data: status, error: null });
    expect(await calendarRequest("status")).toEqual(status);
    invoke.mockResolvedValueOnce({ data: { connected: true }, error: null });
    expect(await calendarRequest("callback", { code: "temporary-code", state: "bound-state" })).toEqual({ connected: true });
    expect(invoke).toHaveBeenLastCalledWith("google-calendar", { body: { action: "callback", code: "temporary-code", state: "bound-state" } });
  });

  it("rejects invalid status instead of presenting a false connection", async () => {
    invoke.mockResolvedValue({ data: { ...status, connected: "true" }, error: null });
    await expect(calendarRequest("status")).rejects.toThrow("Não foi possível acessar o Google Agenda.");
  });

  it.each([
    "https://accounts.google.com.evil.example/o/oauth2/v2/auth",
    "http://accounts.google.com/o/oauth2/v2/auth",
    "https://user:secret@accounts.google.com/o/oauth2/v2/auth",
    "https://accounts.google.com:444/o/oauth2/v2/auth",
    "https://accounts.google.com/other-path",
    "javascript:alert(1)",
  ])("rejects an unapproved OAuth destination %s", async url => {
    invoke.mockResolvedValue({ data: { url }, error: null });
    await expect(calendarRequest("connect")).rejects.toThrow("Não foi possível acessar o Google Agenda.");
    expect(isGoogleCalendarOAuthUrl(url)).toBe(false);
  });

  it("accepts only the Google HTTPS authorization endpoint", async () => {
    const url = "https://accounts.google.com/o/oauth2/v2/auth?client_id=example&state=opaque";
    invoke.mockResolvedValue({ data: { url }, error: null });
    expect(await calendarRequest("connect")).toEqual({ url });
  });

  it("maps public error codes and hides raw backend errors", async () => {
    invoke.mockResolvedValueOnce({ data: { error: "google_reconnect_required" }, error: null });
    await expect(calendarRequest("sync")).rejects.toThrow("Reconecte sua conta Google");
    invoke.mockResolvedValueOnce({ data: null, error: new Error("refresh_token=never-show-this") });
    await expect(calendarRequest("sync")).rejects.toThrow("Não foi possível acessar o Google Agenda.");
    invoke.mockResolvedValueOnce({ data: { error: "refresh_token=never-show-this" }, error: null });
    await expect(calendarRequest("sync")).rejects.toThrow("Não foi possível acessar o Google Agenda.");
  });

  it("does not reject a saved task when synchronization fails and refreshes integration status", async () => {
    const changed = vi.fn();
    window.addEventListener(calendarStatusChangedEvent, changed);
    invoke.mockRejectedValue(new Error("network failure"));
    try {
      await expect(requestTaskCalendarSync()).resolves.toBeNull();
      expect(invoke).toHaveBeenCalledWith("google-calendar", { body: { action: "sync", enqueueAll: false } });
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(calendarStatusChangedEvent, changed);
    }
  });
});
