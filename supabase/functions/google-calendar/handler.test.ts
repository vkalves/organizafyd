import { beforeEach, describe, expect, it, vi } from "vitest";
import { base64, decrypt, encrypt, encryptionKey, sha256 } from "./crypto.ts";
import { eventId, eventPayload, nextDate } from "./events.ts";
import { createGoogleCalendarHandler } from "./handler.ts";
import { SCOPES } from "./google.ts";
import type { CalendarConnection, CalendarStore, EventMapping, OAuthState, QueueItem, Task } from "./types.ts";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const APP = "https://www.organizafy.site";
const DATE = new Date("2028-02-28T15:00:00Z");
const SECRET = base64(new Uint8Array(32).fill(7));
const config = { appUrl: APP, supabaseUrl: "https://project.supabase.co", clientId: "test-client-id", clientSecret: "test-client-secret", encryptionKey: SECRET, workerSecret: "test-worker-secret" };
const task: Task = { id: TASK_ID, user_id: USER, title: "Preparar entrega", description: "Revisar projeto", due_date: "2028-02-28", status: "todo" };
const job: QueueItem = { user_id: USER, task_id: TASK_ID, revision: 1, attempts: 0, created_at: "2028-02-28T12:00:00Z" };

class MemoryStore implements CalendarStore {
  connections = new Map<string, CalendarConnection>();
  states = new Map<string, OAuthState>();
  tasks = new Map<string, Task>();
  events = new Map<string, EventMapping>();
  jobs = new Map<string, QueueItem>();
  locks = new Map<string, string>();
  lastError: string | null = null;
  consumeCount = 0;
  beforeComplete?: () => void;
  authenticate = vi.fn(async (token: string) => token === "valid" ? USER : token === "other" ? OTHER_USER : null);
  async connection(userId: string) { return this.connections.get(userId) ?? null; }
  async saveConnection(value: Partial<CalendarConnection> & { user_id: string }) {
    this.connections.set(value.user_id, { ...this.connections.get(value.user_id), ...value } as CalendarConnection);
  }
  async putState(value: OAuthState) { this.states.set(value.state_hash, value); }
  async state(hash: string, now: string) {
    const value = this.states.get(hash);
    return value && value.expires_at > now ? value : null;
  }
  async consumeState(hash: string, userId: string, now: string) {
    const value = await this.state(hash, now);
    if (!value || value.user_id !== userId) return null;
    this.states.delete(hash);
    this.consumeCount++;
    return value;
  }
  async enqueueAll(userId: string) {
    for (const value of this.tasks.values()) {
      if (value.user_id !== userId) continue;
      const current = this.jobs.get(value.id);
      this.jobs.set(value.id, { ...job, task_id: value.id, user_id: userId, revision: (current?.revision ?? 0) + 1, created_at: current?.created_at ?? DATE.toISOString() });
    }
  }
  async selectCalendar(userId: string, calendarId: string, summary: string) {
    await this.saveConnection({ user_id: userId, calendar_id: calendarId, calendar_summary: summary, sync_error: null });
    await this.enqueueAll(userId);
    for (const mapping of await this.mappings(userId)) {
      if (!this.jobs.has(mapping.task_id)) this.jobs.set(mapping.task_id, { ...job, task_id: mapping.task_id, user_id: userId });
    }
  }
  async claimLock(userId: string, token: string) {
    if (this.locks.has(userId) && this.locks.get(userId) !== token) return false;
    this.locks.set(userId, token);
    return true;
  }
  async releaseLock(userId: string, token: string) { if (this.locks.get(userId) === token) this.locks.delete(userId); }
  async pendingCount(userId: string) { return [...this.jobs.values()].filter((item) => item.user_id === userId).length; }
  async queue(userId: string) { return [...this.jobs.values()].filter((item) => item.user_id === userId); }
  async dueUsers() { return [...new Set([...this.jobs.values()].map((item) => item.user_id))]; }
  async task(userId: string, taskId: string) { const value = this.tasks.get(taskId); return value?.user_id === userId ? value : null; }
  async mapping(userId: string, taskId: string) { const value = this.events.get(taskId); return value?.user_id === userId ? value : null; }
  async mappings(userId: string) { return [...this.events.values()].filter((item) => item.user_id === userId); }
  async saveMapping(value: EventMapping) { this.events.set(value.task_id, value); }
  async removeMapping(userId: string, taskId: string) { if (this.events.get(taskId)?.user_id === userId) this.events.delete(taskId); }
  async clearMappings(userId: string) { for (const value of await this.mappings(userId)) this.events.delete(value.task_id); }
  async dropForeignMappings(userId: string, calendarId: string) { for (const value of await this.mappings(userId)) if (value.calendar_id !== calendarId) this.events.delete(value.task_id); }
  async completeJob(item: QueueItem) {
    this.beforeComplete?.();
    if (this.jobs.get(item.task_id)?.revision === item.revision) this.jobs.delete(item.task_id);
  }
  async failJob(item: QueueItem, error: string) {
    this.lastError = error;
    if (this.jobs.get(item.task_id)?.revision === item.revision) this.jobs.set(item.task_id, { ...item, attempts: item.attempts + 1 });
  }
  async disconnect(userId: string) {
    this.connections.delete(userId);
    for (const value of [...this.jobs.values()]) if (value.user_id === userId) this.jobs.delete(value.task_id);
    for (const [hash, value] of this.states) if (value.user_id === userId) this.states.delete(hash);
  }
}

function response(data: object, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
function request(action: string, extra: object = {}, token = "valid", origin = APP) {
  return new Request("https://project.supabase.co/functions/v1/google-calendar", { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
}

describe("Google Calendar Edge handler", () => {
  let store: MemoryStore;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  let handle: ReturnType<typeof createGoogleCalendarHandler>;
  let key: CryptoKey;

  beforeEach(async () => {
    store = new MemoryStore();
    key = await encryptionKey(SECRET);
    fetcher = vi.fn<typeof fetch>();
    handle = createGoogleCalendarHandler({ store, config, fetch: fetcher, now: () => DATE });
    store.connections.set(USER, { user_id: USER, calendar_id: "owner@gmail.com", calendar_summary: "Pessoal", google_account_id: "owner@gmail.com",
      refresh_token_encrypted: await encrypt("test-refresh", key, USER), access_token_encrypted: await encrypt("test-access", key, USER),
      token_expires_at: "2028-02-28T16:00:00Z", last_synced_at: null, sync_error: null, reconnect_required: false });
  });

  it("rejects unauthorized callers and a different browser origin before Google operations", async () => {
    expect((await handle(request("sync", {}, "invalid"))).status).toBe(401);
    expect((await handle(request("connect", {}, "valid", "https://attacker.example"))).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("status reports safe metadata and never exposes encrypted tokens", async () => {
    const result = await handle(request("status"));
    const text = await result.text();
    expect(JSON.parse(text)).toMatchObject({ configured: true, connected: true, calendarId: "owner@gmail.com", pendingCount: 0 });
    expect(text).not.toContain("token");
    expect(text).not.toContain("v1.");
  });

  it("starts OAuth with hashed state, encrypted PKCE and the exact callback", async () => {
    const result = await (await handle(request("connect"))).json();
    const url = new URL(result.url);
    const state = url.searchParams.get("state")!;
    const saved = store.states.get(await sha256(state))!;
    expect(saved.user_id).toBe(USER);
    expect(saved.code_verifier_encrypted).toMatch(/^v1\./);
    expect(url.searchParams.get("redirect_uri")).toBe("https://project.supabase.co/functions/v1/google-calendar");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe(SCOPES.join(" "));
  });

  async function putOAuthState() {
    const state = "test-valid-state";
    await store.putState({ state_hash: await sha256(state), user_id: USER, code_verifier_encrypted: await encrypt("test-verifier", key, USER), expires_at: "2028-02-28T15:10:00Z" });
    return state;
  }

  it("GET callback only redirects fragment; it cannot link a Google account", async () => {
    const state = await putOAuthState();
    const result = await handle(new Request(`https://project.supabase.co/functions/v1/google-calendar?code=test-code&state=${state}&redirect_uri=https://evil.example`));
    const target = new URL(result.headers.get("Location")!);
    expect(target.origin).toBe(APP);
    expect(target.pathname).toBe("/config");
    expect(target.search).toBe("?google_calendar=callback");
    expect(target.hash).toContain("google_calendar_code=test-code");
    expect(store.consumeCount).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("binds completion to the authenticated user without consuming a victim's state", async () => {
    const state = await putOAuthState();
    const result = await handle(request("callback", { code: "test-code", state }, "other"));
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "oauth_state_invalid" });
    expect(store.consumeCount).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("completes OAuth once under the user lock and stores only encrypted Google tokens", async () => {
    store.connections.delete(USER);
    const state = await putOAuthState();
    fetcher.mockResolvedValueOnce(response({ access_token: "new-test-access", refresh_token: "new-test-refresh", expires_in: 3600, scope: SCOPES.join(" ") }))
      .mockResolvedValueOnce(response({ items: [{ id: "new@gmail.com", summary: "Agenda", primary: true, accessRole: "owner" }] }));
    const result = await handle(request("callback", { code: "test-code", state }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ connected: true });
    expect(store.connections.get(USER)?.calendar_id).toBe("new@gmail.com");
    expect(store.connections.get(USER)?.refresh_token_encrypted).not.toBe("new-test-refresh");
    expect(await decrypt(store.connections.get(USER)!.refresh_token_encrypted, key, USER)).toBe("new-test-refresh");
    expect((await handle(request("callback", { code: "test-code", state }))).status).toBe(400);
    expect(store.consumeCount).toBe(1);
  });

  it("does not complete initial connection while another callback owns the same user lock", async () => {
    store.connections.delete(USER);
    const state = await putOAuthState();
    store.locks.set(USER, "another-callback");
    expect((await handle(request("callback", { code: "test-code", state }))).status).toBe(409);
    expect(store.consumeCount).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("creates an all-day event, retries conflict by PATCH, and preserves newer queue revisions", async () => {
    store.tasks.set(TASK_ID, task);
    store.jobs.set(TASK_ID, { ...job });
    store.beforeComplete = () => store.jobs.set(TASK_ID, { ...job, revision: 2 });
    fetcher.mockResolvedValueOnce(response({ items: [] })).mockResolvedValueOnce(response({}, 409)).mockResolvedValueOnce(response({}));
    const result = await (await handle(request("sync", { enqueueAll: false, userId: OTHER_USER }))).json();
    expect(result).toMatchObject({ connected: true, synced: 1, pending: 1, errors: 0 });
    const insert = JSON.parse(fetcher.mock.calls[1][1]!.body as string);
    expect(insert.start).toEqual({ date: "2028-02-28" });
    expect(insert.end).toEqual({ date: "2028-02-29" });
    expect(insert.id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(insert.description).toContain(`${APP}/tarefas?task=${TASK_ID}`);
    expect(fetcher.mock.calls[2][1]!.method).toBe("PATCH");
    expect(store.jobs.get(TASK_ID)?.revision).toBe(2);
  });

  it("removes only the mapped event after clearing a task date and accepts an already-deleted event", async () => {
    store.tasks.set(TASK_ID, { ...task, due_date: null });
    store.jobs.set(TASK_ID, { ...job });
    store.events.set(TASK_ID, { user_id: USER, task_id: TASK_ID, calendar_id: "owner@gmail.com", event_id: "mapped-event", synced_at: DATE.toISOString() });
    fetcher.mockResolvedValueOnce(response({}, 404));
    const result = await (await handle(request("sync", { enqueueAll: false }))).json();
    expect(result).toMatchObject({ synced: 1, pending: 0, errors: 0 });
    expect(String(fetcher.mock.calls[0][0])).toContain("/events/mapped-event");
    expect(fetcher.mock.calls[0][1]!.method).toBe("DELETE");
    expect(store.events.size).toBe(0);
  });

  it("reuses a retained Google event when local mapping is absent", async () => {
    store.tasks.set(TASK_ID, task);
    store.jobs.set(TASK_ID, { ...job });
    fetcher.mockResolvedValueOnce(response({ items: [{ id: "retained-event" }] })).mockResolvedValueOnce(response({}));
    expect((await handle(request("sync", { enqueueAll: false }))).status).toBe(200);
    expect(fetcher.mock.calls[1][1]!.method).toBe("PATCH");
    expect(store.events.get(TASK_ID)?.event_id).toBe("retained-event");
  });

  it("cleans up a Google insertion whose mapping failed before the task was deleted", async () => {
    store.jobs.set(TASK_ID, { ...job });
    fetcher.mockResolvedValueOnce(response({ items: [{ id: "orphan-event" }] })).mockResolvedValueOnce(response({}, 410));
    const result = await (await handle(request("sync", { enqueueAll: false }))).json();
    expect(result).toMatchObject({ synced: 1, pending: 0, errors: 0 });
    expect(fetcher.mock.calls[1][1]!.method).toBe("DELETE");
    expect(String(fetcher.mock.calls[1][0])).toContain("orphan-event");
  });

  it("recovers a manually deleted Google event with a fresh deterministic ID", async () => {
    store.tasks.set(TASK_ID, task);
    store.jobs.set(TASK_ID, { ...job });
    store.events.set(TASK_ID, { user_id: USER, task_id: TASK_ID, calendar_id: "owner@gmail.com", event_id: "old-event", synced_at: DATE.toISOString() });
    fetcher.mockResolvedValueOnce(response({}, 410)).mockResolvedValueOnce(response({}));
    expect((await (await handle(request("sync", { enqueueAll: false }))).json()).errors).toBe(0);
    expect(store.events.get(TASK_ID)?.event_id).not.toBe("old-event");
    expect(fetcher.mock.calls[1][1]!.method).toBe("POST");
  });

  it("marks invalid refresh grants for reconnection without leaking Google's body", async () => {
    store.connections.get(USER)!.token_expires_at = "2028-02-28T14:00:00Z";
    store.tasks.set(TASK_ID, task);
    store.jobs.set(TASK_ID, { ...job });
    fetcher.mockResolvedValueOnce(response({ error: "invalid_grant", error_description: "sensitive provider detail" }, 400));
    const result = await (await handle(request("sync", { enqueueAll: false }))).json();
    expect(result).toMatchObject({ errors: 1, reconnectRequired: true, pending: 1 });
    expect(store.connections.get(USER)?.sync_error).toBe("google_reconnect_required");
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });

  it("disconnects while retaining mapped Google events for a later reconnection", async () => {
    store.jobs.set(TASK_ID, { ...job });
    store.events.set(TASK_ID, { user_id: USER, task_id: TASK_ID, calendar_id: "owner@gmail.com", event_id: "retained-event", synced_at: DATE.toISOString() });
    fetcher.mockResolvedValueOnce(response({}));
    expect(await (await handle(request("disconnect"))).json()).toEqual({ connected: false });
    expect(store.connections.size).toBe(0);
    expect(store.jobs.size).toBe(0);
    expect(store.events.get(TASK_ID)?.event_id).toBe("retained-event");
    expect(String(fetcher.mock.calls[0][0])).toBe("https://oauth2.googleapis.com/revoke");
    expect(fetcher.mock.calls).toHaveLength(1);
  });

  it("denies a read-only calendar selection", async () => {
    fetcher.mockResolvedValueOnce(response({ id: "readonly", summary: "Somente leitura", accessRole: "reader" }));
    const result = await handle(request("select_calendar", { calendarId: "readonly" }));
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "calendar_not_writable" });
    expect(store.connections.get(USER)?.calendar_id).toBe("owner@gmail.com");
  });

  it("moves calendar events through the durable queue instead of deleting them during selection", async () => {
    store.tasks.set(TASK_ID, task);
    store.events.set(TASK_ID, { user_id: USER, task_id: TASK_ID, calendar_id: "owner@gmail.com", event_id: "old-calendar-event", synced_at: DATE.toISOString() });
    fetcher.mockResolvedValueOnce(response({ id: "new-calendar", summary: "Trabalho", accessRole: "writer" }));
    const result = await handle(request("select_calendar", { calendarId: "new-calendar" }));
    expect(result.status).toBe(200);
    expect(store.connections.get(USER)?.calendar_id).toBe("new-calendar");
    expect(store.events.get(TASK_ID)?.calendar_id).toBe("owner@gmail.com");
    expect(store.jobs.has(TASK_ID)).toBe(true);
    expect(fetcher.mock.calls).toHaveLength(1);

    fetcher.mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({ items: [] })).mockResolvedValueOnce(response({}));
    expect((await (await handle(request("sync", { enqueueAll: false }))).json()).errors).toBe(0);
    expect(fetcher.mock.calls[1][1]!.method).toBe("DELETE");
    expect(String(fetcher.mock.calls[3][0])).toContain("calendars/new-calendar/events");
    expect(store.events.get(TASK_ID)?.calendar_id).toBe("new-calendar");
  });

  it("requires the distinct worker secret even when the caller has a valid user session", async () => {
    const result = await handle(request("process_queue"));
    expect(result.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.authenticate).not.toHaveBeenCalled();
  });

  it("encrypts authenticated ciphertext bound to its owner and computes exclusive UTC end dates", async () => {
    const ciphertext = await encrypt("test-secret", key, USER);
    expect(await decrypt(ciphertext, key, USER)).toBe("test-secret");
    await expect(decrypt(ciphertext, key, OTHER_USER)).rejects.toThrow();
    expect(nextDate("2028-02-29")).toBe("2028-03-01");
    expect(nextDate("2028-12-31")).toBe("2029-01-01");
    expect(() => nextDate("2027-02-29")).toThrow();
    expect(eventPayload({ ...task, status: "done" }, APP).summary).toBe("✓ Preparar entrega");
    expect(await eventId(TASK_ID, job.created_at)).toBe(await eventId(TASK_ID, job.created_at));
  });
});
