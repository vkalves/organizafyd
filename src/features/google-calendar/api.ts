import { supabase } from "@/integrations/supabase/client";

export interface CalendarStatus {
  configured: boolean;
  connected: boolean;
  reconnectRequired: boolean;
  calendarId: string | null;
  calendarSummary: string | null;
  lastSyncedAt: string | null;
  pendingCount: number;
  syncError: string | null;
}

export interface WritableCalendar {
  id: string;
  summary: string;
  primary?: boolean;
}

export interface CalendarSyncResult {
  connected: boolean;
  synced: number;
  pending: number;
  errors: number;
  reconnectRequired: boolean;
}

interface CalendarResponses {
  status: CalendarStatus;
  connect: { url: string };
  callback: { connected: boolean };
  calendars: { calendars: WritableCalendar[] };
  select_calendar: { success?: boolean };
  sync: CalendarSyncResult;
  disconnect: { success?: boolean };
}

export type CalendarAction = keyof CalendarResponses;

const genericError = "Não foi possível acessar o Google Agenda. Tente novamente mais tarde.";
const messages: Record<string, string> = {
  google_reconnect_required: "Reconecte sua conta Google para continuar a sincronização.",
  google_calendar_unavailable: genericError,
  calendar_not_writable: "Esta agenda não permite criar eventos. Escolha outra agenda.",
  calendar_busy: "Há uma sincronização em andamento. Tente novamente em instantes.",
  sync_failed: "Algumas alterações ainda não foram sincronizadas. Tente sincronizar novamente.",
};

function messageForCode(code: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(messages, code) ? messages[code] : undefined;
}

export class CalendarRequestError extends Error {
  constructor(public readonly code: string = "request_failed") {
    super(messageForCode(code) || genericError);
    this.name = "CalendarRequestError";
  }
}

export function calendarErrorMessage(error: unknown): string {
  return error instanceof CalendarRequestError ? error.message : genericError;
}

export function calendarSyncErrorMessage(code: string): string {
  return messageForCode(code) || messages.sync_failed;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function publicErrorCode(value: unknown): string {
  if (!isObject(value)) return "request_failed";
  const code = typeof value.code === "string" ? value.code : value.error;
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(messages, code)
    ? code
    : "request_failed";
}

export function isGoogleCalendarOAuthUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "accounts.google.com"
      && (url.port === "" || url.port === "443")
      && !url.username && !url.password
      && ["/o/oauth2/v2/auth", "/o/oauth2/auth"].includes(url.pathname);
  } catch {
    return false;
  }
}

function validateResponse(action: CalendarAction, value: unknown): boolean {
  if (!isObject(value)) return false;
  if (action === "connect") return isGoogleCalendarOAuthUrl(value.url);
  if (action === "callback") return typeof value.connected === "boolean";
  if (action === "status") {
    return ["configured", "connected", "reconnectRequired"].every(key => typeof value[key] === "boolean")
      && ["calendarId", "calendarSummary", "lastSyncedAt", "syncError"].every(key => value[key] === null || typeof value[key] === "string")
      && typeof value.pendingCount === "number" && Number.isFinite(value.pendingCount) && value.pendingCount >= 0;
  }
  if (action === "calendars") {
    return Array.isArray(value.calendars) && value.calendars.every(calendar =>
      isObject(calendar) && typeof calendar.id === "string" && typeof calendar.summary === "string",
    );
  }
  if (action === "sync") {
    return typeof value.connected === "boolean" && typeof value.reconnectRequired === "boolean"
      && ["synced", "pending", "errors"].every(key => typeof value[key] === "number" && Number.isFinite(value[key]) && (value[key] as number) >= 0);
  }
  return value.success === undefined || typeof value.success === "boolean";
}

export async function calendarRequest<Action extends CalendarAction>(
  action: Action,
  payload?: Action extends "select_calendar" ? { calendarId: string }
    : Action extends "callback" ? { code: string; state: string }
      : Action extends "sync" ? { enqueueAll?: boolean }
      : Record<string, never>,
): Promise<CalendarResponses[Action]> {
  try {
    const { data, error } = await supabase.functions.invoke("google-calendar", {
      body: { ...payload, action },
    });
    if (error) {
      let body: unknown = null;
      // Only known public error codes are used; server details and credentials never reach the UI.
      if (isObject(error) && error.context instanceof Response) {
        try { body = await error.context.clone().json(); } catch { /* Keep the generic message. */ }
      }
      throw new CalendarRequestError(publicErrorCode(body));
    }
    if (isObject(data) && data.error) throw new CalendarRequestError(publicErrorCode(data));
    if (!validateResponse(action, data)) throw new CalendarRequestError();
    return data as CalendarResponses[Action];
  } catch (error) {
    throw error instanceof CalendarRequestError ? error : new CalendarRequestError();
  }
}

export const calendarStatusChangedEvent = "google-calendar-status-changed";

/** The task is already saved; a calendar outage must not reject a task mutation. */
export async function requestTaskCalendarSync(): Promise<CalendarSyncResult | null> {
  try {
    return await calendarRequest("sync", { enqueueAll: false });
  } catch {
    return null;
  } finally {
    window.dispatchEvent(new CustomEvent(calendarStatusChangedEvent));
  }
}
