import { decrypt, encrypt } from "./crypto.ts";
import { CalendarError } from "./types.ts";
import type { Calendar, CalendarConfig, CalendarConnection, CalendarStore } from "./types.ts";

export const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

export async function exchangeToken(fetcher: typeof fetch, body: URLSearchParams): Promise<GoogleTokens> {
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST", body, signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json() as Partial<GoogleTokens> & { error?: string };
  if (!response.ok) {
    if (data.error === "invalid_grant") throw new CalendarError("google_reconnect_required", 409);
    throw new CalendarError("google_calendar_unavailable", 502);
  }
  if (!data.access_token || !Number.isFinite(data.expires_in)) throw new CalendarError("google_calendar_unavailable", 502);
  return data as GoogleTokens;
}

export class GoogleApiError extends CalendarError {
  constructor(public googleStatus: number) {
    super(googleStatus === 401 ? "google_reconnect_required" : "google_calendar_unavailable", 502);
  }
}

export class GoogleSession {
  constructor(
    public connection: CalendarConnection,
    private store: CalendarStore,
    private config: CalendarConfig,
    private key: CryptoKey,
    private fetcher: typeof fetch,
    private now: () => Date,
    private beforeRequest: () => Promise<void> = async () => {},
    private persistCredentials = true,
  ) {}

  private async accessToken(forceRefresh = false): Promise<string> {
    const connection = this.connection;
    if (!forceRefresh && connection.access_token_encrypted && connection.token_expires_at &&
      new Date(connection.token_expires_at).getTime() > this.now().getTime() + 60_000) {
      return decrypt(connection.access_token_encrypted, this.key, connection.user_id);
    }
    try {
      await this.beforeRequest();
      const tokens = await exchangeToken(this.fetcher, new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: await decrypt(connection.refresh_token_encrypted, this.key, connection.user_id),
        client_id: this.config.clientId!, client_secret: this.config.clientSecret!,
      }));
      const changes = {
        user_id: connection.user_id,
        access_token_encrypted: await encrypt(tokens.access_token, this.key, connection.user_id),
        token_expires_at: new Date(this.now().getTime() + tokens.expires_in * 1000).toISOString(),
        ...(tokens.refresh_token ? { refresh_token_encrypted: await encrypt(tokens.refresh_token, this.key, connection.user_id) } : {}),
        reconnect_required: false,
      };
      if (this.persistCredentials) await this.store.saveConnection(changes);
      Object.assign(this.connection, changes);
      return tokens.access_token;
    } catch (error) {
      if (error instanceof CalendarError && error.code === "google_reconnect_required") {
        if (this.persistCredentials) await this.store.saveConnection({ user_id: connection.user_id, reconnect_required: true, sync_error: error.code });
        this.connection.reconnect_required = true;
      }
      throw error;
    }
  }

  async request(path: string, method = "GET", payload?: object, allowStatuses: number[] = []): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.beforeRequest();
      const accessToken = await this.accessToken(attempt === 1);
      const response = await this.fetcher(`https://www.googleapis.com/calendar/v3/${path}`, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: AbortSignal.timeout(12_000),
      });
      if (response.status === 401 && attempt === 0) continue;
      if (!response.ok && !allowStatuses.includes(response.status)) {
        if (response.status === 401) {
          if (this.persistCredentials) await this.store.saveConnection({ user_id: this.connection.user_id, reconnect_required: true, sync_error: "google_reconnect_required" });
          this.connection.reconnect_required = true;
        }
        throw new GoogleApiError(response.status);
      }
      return response;
    }
    throw new CalendarError("google_calendar_unavailable", 502);
  }

  async calendars(): Promise<Calendar[]> {
    const calendars: Calendar[] = [];
    let nextPage: string | undefined;
    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({ maxResults: "250", minAccessRole: "writer" });
      if (nextPage) params.set("pageToken", nextPage);
      const response = await this.request(`users/me/calendarList?${params}`);
      const data = await response.json() as { items?: Calendar[]; nextPageToken?: string };
      calendars.push(...(data.items ?? []).filter((item) => item.accessRole === "owner" || item.accessRole === "writer"));
      nextPage = data.nextPageToken;
      if (!nextPage) return calendars;
    }
    throw new CalendarError("google_calendar_unavailable", 502);
  }

  async calendar(id: string): Promise<Calendar> {
    if (id === "primary") {
      const primary = (await this.calendars()).find((calendar) => calendar.primary);
      if (!primary) throw new CalendarError("calendar_not_writable", 400);
      return primary;
    }
    const response = await this.request(`users/me/calendarList/${encodeURIComponent(id)}`, "GET", undefined, [404]);
    if (response.status === 404) throw new CalendarError("calendar_not_writable", 400);
    const calendar = await response.json() as Calendar;
    if (calendar.accessRole !== "owner" && calendar.accessRole !== "writer") throw new CalendarError("calendar_not_writable", 400);
    return calendar;
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await this.request(`calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, "DELETE", undefined, [404, 410]);
  }

  async existingEvent(calendarId: string, taskId: string): Promise<string | null> {
    const params = new URLSearchParams({ privateExtendedProperty: `organizafy_task_id=${taskId}`, showDeleted: "false", maxResults: "2" });
    const response = await this.request(`calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    const data = await response.json() as { items?: { id: string }[] };
    return data.items?.[0]?.id ?? null;
  }

  async upsertEvent(calendarId: string, eventId: string, payload: object, known: boolean, recoveryId: string): Promise<string> {
    const collection = `calendars/${encodeURIComponent(calendarId)}/events`;
    let resource = `${collection}/${encodeURIComponent(eventId)}?sendUpdates=none`;
    if (known) {
      const update = await this.request(resource, "PATCH", payload, [404, 410]);
      if (update.ok) return eventId;
      // A manually deleted Google event has a tombstone; its ID cannot always be reused.
      eventId = recoveryId;
      resource = `${collection}/${encodeURIComponent(eventId)}?sendUpdates=none`;
    }
    const insert = await this.request(`${collection}?sendUpdates=none`, "POST", { ...payload, id: eventId }, [409]);
    if (insert.status === 409) await this.request(resource, "PATCH", payload);
    return eventId;
  }

  async revoke(): Promise<void> {
    const token = await decrypt(this.connection.refresh_token_encrypted, this.key, this.connection.user_id);
    const response = await this.fetcher("https://oauth2.googleapis.com/revoke", {
      method: "POST", body: new URLSearchParams({ token }), signal: AbortSignal.timeout(12_000),
    });
    // Already revoked is a successful disconnect. Do not erase local credentials on a transient failure.
    if (!response.ok && response.status !== 400) throw new CalendarError("google_calendar_unavailable", 502);
  }
}
