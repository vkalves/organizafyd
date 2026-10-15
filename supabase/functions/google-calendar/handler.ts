import { challenge, decrypt, encrypt, encryptionKey, fromBase64, randomSecret, secretsEqual, sha256 } from "./crypto.ts";
import { eventId, eventPayload, retryDate } from "./events.ts";
import { exchangeToken, GoogleSession, SCOPES } from "./google.ts";
import { CalendarError } from "./types.ts";
import type { CalendarConnection, Dependencies, QueueItem } from "./types.ts";

type Payload = { action?: string; calendarId?: unknown; code?: unknown; state?: unknown; enqueueAll?: unknown };
type SyncResult = { connected: boolean; synced: number; pending: number; errors: number; reconnectRequired: boolean };
const LEASE_SECONDS = 300;

/** No Deno globals: inject storage, configuration, fetch and clock for deterministic tests. */
export function createGoogleCalendarHandler(dependencies: Dependencies): (request: Request) => Promise<Response> {
  const { store, config } = dependencies;
  const fetcher = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  let appUrl: URL | null = null;
  try {
    if (config.appUrl) {
      const parsed = new URL(config.appUrl);
      if (parsed.protocol === "https:" || (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) {
        appUrl = new URL(parsed.origin);
      }
    }
  } catch { /* Configuration is reported as unavailable, without exposing values. */ }
  let validEncryptionKey = false;
  try { validEncryptionKey = Boolean(config.encryptionKey && fromBase64(config.encryptionKey).length === 32); } catch { /* Invalid secret configuration. */ }
  const configured = Boolean(appUrl && config.supabaseUrl && config.clientId && config.clientSecret && validEncryptionKey);
  const cors = {
    ...(appUrl ? { "Access-Control-Allow-Origin": appUrl.origin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
  const json = (data: object, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
  const redirect = (outcome: string, fragment?: URLSearchParams) => {
    if (!appUrl) return json({ error: "google_calendar_not_configured" }, 503);
    const target = new URL("/config", appUrl);
    target.searchParams.set("google_calendar", outcome);
    if (fragment) target.hash = fragment.toString();
    return new Response(null, { status: 302, headers: { Location: target.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  };
  const requireConfigured = () => {
    if (!configured) throw new CalendarError("google_calendar_not_configured", 503);
  };
  const key = () => encryptionKey(config.encryptionKey!);
  const callbackUrl = () => `${config.supabaseUrl!.replace(/\/$/, "")}/functions/v1/google-calendar`;
  const renew = async (userId: string, token: string) => {
    if (!await store.claimLock(userId, token, LEASE_SECONDS)) throw new CalendarError("calendar_busy", 409);
  };
  const session = async (connection: CalendarConnection, lockToken: string) => new GoogleSession(
    connection, store, config, await key(), fetcher, now, () => renew(connection.user_id, lockToken),
  );
  const withUserLock = async <T>(userId: string, run: (lockToken: string, connection: CalendarConnection | null) => Promise<T>): Promise<T> => {
    const token = crypto.randomUUID();
    if (!await store.claimLock(userId, token, LEASE_SECONDS)) throw new CalendarError("calendar_busy", 409);
    try {
      const connection = await store.connection(userId);
      return await run(token, connection);
    } finally {
      await store.releaseLock(userId, token);
    }
  };
  const withLock = async <T>(userId: string, run: (lockToken: string, connection: CalendarConnection) => Promise<T>): Promise<T> =>
    withUserLock(userId, (token, connection) => {
      if (!connection) throw new CalendarError("google_calendar_not_connected", 409);
      return run(token, connection);
    });

  async function syncJob(api: GoogleSession, item: QueueItem): Promise<void> {
    const [task, mapping] = await Promise.all([store.task(item.user_id, item.task_id), store.mapping(item.user_id, item.task_id)]);
    if (!task?.due_date) {
      if (mapping) {
        await api.deleteEvent(mapping.calendar_id, mapping.event_id);
        await store.removeMapping(item.user_id, item.task_id);
      } else {
        // Insertion may have succeeded before a mapping write failed. Remove that orphan on a later deletion.
        const orphan = await api.existingEvent(api.connection.calendar_id, item.task_id);
        if (orphan) await api.deleteEvent(api.connection.calendar_id, orphan);
      }
      await store.completeJob(item);
      return;
    }
    const calendarId = api.connection.calendar_id;
    if (mapping && mapping.calendar_id !== calendarId) {
      await api.deleteEvent(mapping.calendar_id, mapping.event_id);
      await store.removeMapping(item.user_id, item.task_id);
    }
    const knownId = mapping?.calendar_id === calendarId ? mapping.event_id : await api.existingEvent(calendarId, task.id);
    const freshId = await eventId(task.id, item.created_at);
    const recoveredId = await eventId(task.id, `${item.created_at}:${item.revision}:recovered`);
    const actualId = await api.upsertEvent(calendarId, knownId ?? freshId, eventPayload(task, appUrl!.href), Boolean(knownId), recoveredId);
    await store.saveMapping({ user_id: item.user_id, task_id: item.task_id, calendar_id: calendarId, event_id: actualId, synced_at: now().toISOString() });
    // A concurrent task edit increments revision; only the exact processed revision can be acknowledged.
    await store.completeJob(item);
  }

  async function syncUser(userId: string, deadline: number): Promise<SyncResult> {
    const connection = await store.connection(userId);
    if (!connection) return { connected: false, synced: 0, pending: 0, errors: 0, reconnectRequired: false };
    if (connection.reconnect_required) return { connected: true, synced: 0, pending: await store.pendingCount(userId), errors: 0, reconnectRequired: true };
    const token = crypto.randomUUID();
    if (!await store.claimLock(userId, token, LEASE_SECONDS)) {
      return { connected: true, synced: 0, pending: await store.pendingCount(userId), errors: 0, reconnectRequired: false };
    }
    let synced = 0;
    let errors = 0;
    let errorCode: string | null = null;
    try {
      // Re-read under the lock; a reconnect may have replaced credentials since the initial query.
      const current = await store.connection(userId);
      if (!current) return { connected: false, synced: 0, pending: 0, errors: 0, reconnectRequired: false };
      if (current.reconnect_required) return { connected: true, synced: 0, pending: await store.pendingCount(userId), errors: 0, reconnectRequired: true };
      const api = await session(current, token);
      for (const item of await store.queue(userId, now().toISOString(), 20)) {
        if (Date.now() >= deadline) break;
        try {
          await renew(userId, token);
          await syncJob(api, item);
          synced++;
        } catch (error) {
          errorCode = error instanceof CalendarError ? error.code : "sync_failed";
          errors++;
          await store.failJob(item, errorCode, retryDate(item, now()));
          if (errorCode === "google_reconnect_required" || errorCode === "calendar_busy") break;
        }
      }
      const pending = await store.pendingCount(userId);
      await store.saveConnection({ user_id: userId, ...(synced ? { last_synced_at: now().toISOString() } : {}),
        sync_error: errorCode ?? (pending === 0 ? null : current.sync_error) });
      return { connected: true, synced, pending, errors, reconnectRequired: api.connection.reconnect_required };
    } finally {
      await store.releaseLock(userId, token);
    }
  }

  async function finishCallback(userId: string, payload: Payload): Promise<Response> {
    if (typeof payload.code !== "string" || !payload.code || payload.code.length > 4096 ||
      typeof payload.state !== "string" || !payload.state || payload.state.length > 256) throw new CalendarError("oauth_state_invalid");
    const hash = await sha256(payload.state);
    const state = await store.state(hash, now().toISOString());
    if (!state || state.user_id !== userId) throw new CalendarError("oauth_state_invalid");
    const finish = async (lockToken: string, existing: CalendarConnection | null) => {
      const consumed = await store.consumeState(hash, userId, now().toISOString());
      if (!consumed) throw new CalendarError("oauth_state_invalid");
      const encryption = await key();
      const tokens = await exchangeToken(fetcher, new URLSearchParams({
        grant_type: "authorization_code", code: payload.code as string,
        client_id: config.clientId!, client_secret: config.clientSecret!, redirect_uri: callbackUrl(),
        code_verifier: await decrypt(consumed.code_verifier_encrypted, encryption, userId),
      }));
      if (!tokens.refresh_token) throw new CalendarError("google_refresh_token_missing", 409);
      if (tokens.scope && !SCOPES.every((scope) => tokens.scope!.split(" ").includes(scope))) {
        throw new CalendarError("google_calendar_permission_required", 403);
      }
      const next: CalendarConnection = {
        user_id: userId, calendar_id: "primary", calendar_summary: "Agenda principal", google_account_id: null,
        refresh_token_encrypted: await encrypt(tokens.refresh_token, encryption, userId),
        access_token_encrypted: await encrypt(tokens.access_token, encryption, userId),
        token_expires_at: new Date(now().getTime() + tokens.expires_in * 1000).toISOString(),
        last_synced_at: null, sync_error: null, reconnect_required: false,
      };
      // Candidate tokens must not mutate an existing connection before the account/calendar validation succeeds.
      const api = new GoogleSession(next, store, config, encryption, fetcher, now, () => renew(userId, lockToken), false);
      const primary = await api.calendar("primary");
      next.google_account_id = primary.id;
      next.calendar_id = primary.id;
      next.calendar_summary = primary.summary;
      if (existing?.google_account_id === primary.id) {
        try {
          const selected = await api.calendar(existing.calendar_id);
          next.calendar_id = selected.id;
          next.calendar_summary = selected.summary;
          next.last_synced_at = existing.last_synced_at;
        } catch (error) {
          if (!(error instanceof CalendarError) || error.code !== "calendar_not_writable") throw error;
          // A removed calendar cannot be reused. Previous events are kept on account reconnect.
          await store.dropForeignMappings(userId, primary.id);
        }
      } else if (existing) {
        // Switching Google accounts must never delete events using credentials from the new account.
        await store.clearMappings(userId);
      } else {
        await store.dropForeignMappings(userId, primary.id);
      }
      await store.saveConnection(next);
      await store.enqueueAll(userId);
      return json({ connected: true });
    };
    return withUserLock(userId, finish);
  }

  return async (request: Request): Promise<Response> => {
    try {
      const origin = request.headers.get("Origin");
      if (origin && origin !== appUrl?.origin) return json({ error: "origin_not_allowed" }, 403);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (request.method === "GET") {
        requireConfigured();
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (url.searchParams.has("error") || !code || !state || state.length > 256 || code.length > 4096) return redirect("error");
        if (!await store.state(await sha256(state), now().toISOString())) return redirect("error");
        // Complete with the still-authenticated website user; the unauthenticated GET never stores Google tokens.
        return redirect("callback", new URLSearchParams({ google_calendar_code: code, google_calendar_state: state }));
      }
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const body = await request.json() as Payload;
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_request" }, 400);
      if (body.action === "process_queue") {
        requireConfigured();
        const secret = request.headers.get("X-Calendar-Worker-Secret");
        if (!config.workerSecret || !secret || !await secretsEqual(secret, config.workerSecret)) return json({ error: "unauthorized" }, 401);
        const deadline = Date.now() + 40_000;
        const results: SyncResult[] = [];
        for (const userId of await store.dueUsers(now().toISOString(), 20)) {
          if (Date.now() >= deadline) break;
          results.push(await syncUser(userId, deadline));
        }
        return json({ users: results.length, synced: results.reduce((sum, item) => sum + item.synced, 0), errors: results.reduce((sum, item) => sum + item.errors, 0) });
      }
      const bearer = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
      const userId = bearer ? await store.authenticate(bearer) : null;
      if (!userId) return json({ error: "unauthorized" }, 401);
      if (body.action === "status") {
        const connection = await store.connection(userId);
        return json({ configured, connected: Boolean(connection), reconnectRequired: connection?.reconnect_required ?? false,
          calendarId: connection?.calendar_id ?? null, calendarSummary: connection?.calendar_summary ?? null,
          lastSyncedAt: connection?.last_synced_at ?? null, pendingCount: connection ? await store.pendingCount(userId) : 0,
          syncError: connection?.sync_error ?? null });
      }
      requireConfigured();
      if (body.action === "connect") {
        const state = randomSecret();
        const verifier = randomSecret(48);
        await store.putState({ state_hash: await sha256(state), user_id: userId,
          code_verifier_encrypted: await encrypt(verifier, await key(), userId),
          expires_at: new Date(now().getTime() + 10 * 60_000).toISOString() });
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.search = new URLSearchParams({ client_id: config.clientId!, redirect_uri: callbackUrl(), response_type: "code",
          scope: SCOPES.join(" "), access_type: "offline", prompt: "consent select_account", state,
          code_challenge: await challenge(verifier), code_challenge_method: "S256", include_granted_scopes: "true" }).toString();
        return json({ url: url.href });
      }
      if (body.action === "callback") return await finishCallback(userId, body);
      if (body.action === "sync") {
        const connection = await store.connection(userId);
        if (connection && body.enqueueAll !== false) await store.enqueueAll(userId);
        return json(await syncUser(userId, Date.now() + 40_000));
      }
      if (body.action === "calendars") return await withLock(userId, async (token, connection) => {
        const calendars = await (await session(connection, token)).calendars();
        return json({ calendars: calendars.map(({ id, summary, primary }) => ({ id, summary, primary: Boolean(primary) })) });
      });
      if (body.action === "select_calendar") {
        if (typeof body.calendarId !== "string" || !body.calendarId || body.calendarId.length > 1024) throw new CalendarError("calendar_not_writable");
        return await withLock(userId, async (token, connection) => {
          const api = await session(connection, token);
          const selected = await api.calendar(body.calendarId as string);
          if (selected.id !== connection.calendar_id) {
            // Switch and enqueue atomically. The worker moves events in bounded, retryable batches.
            await store.selectCalendar(userId, selected.id, selected.summary);
          }
          return json({ calendarId: selected.id, calendarSummary: selected.summary });
        });
      }
      if (body.action === "disconnect") {
        if (!await store.connection(userId)) return json({ connected: false });
        return await withLock(userId, async (token, connection) => {
          await (await session(connection, token)).revoke();
          await store.disconnect(userId);
          return json({ connected: false });
        });
      }
      return json({ error: "unknown_action" }, 400);
    } catch (error) {
      if (error instanceof CalendarError) return json({ error: error.code }, error.status);
      if (error instanceof SyntaxError) return json({ error: "invalid_request" }, 400);
      // Never send Google/database exceptions, credentials or token response bodies to a browser or log.
      return json({ error: "google_calendar_unavailable" }, 500);
    }
  };
}
