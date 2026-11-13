// TypeScript / browser-authorization.ts / browser / short-lived OAuth proof storage
const PREFIX = "ig-login:";
const PENDING = "ig-authorization-pending";
const TTL = 10 * 60_000;
export type BrowserAuthorization = {
  state: string;
  verifier: string;
  expiresAt: number;
  expectedUsername?: string;
  selection?: string;
};
function storageRead(storage: Storage, key: string): string | null {
  try { return storage.getItem(key); } catch { return null; }
}
function storageRemove(storage: Storage, key: string) {
  try { storage.removeItem(key); } catch { /* unavailable storage */ }
}
export function readBrowserAuthorization(state: string): BrowserAuthorization | null {
  if (!state || state.length > 100) return null;
  const key = PREFIX + state;
  const local = storageRead(localStorage, key);
  const session = storageRead(sessionStorage, key);
  for (const raw of [local, session]) {
    if (!raw) continue;
    try {
      const value = JSON.parse(raw);
      if (typeof value.verifier === "string" && value.verifier.length <= 128 &&
          typeof value.expiresAt === "number" && value.expiresAt > Date.now() &&
          value.expiresAt <= Date.now() + TTL + 1000) {
        return { state, verifier: value.verifier, expiresAt: value.expiresAt,
          ...(typeof value.expectedUsername === "string" ? { expectedUsername: value.expectedUsername } : {}) };
      }
    } catch {
      // Preserve callback compatibility with the old, tab-only proof format.
      if (raw === session && /^[a-f0-9]{64}$/.test(raw)) {
        const record = { state, verifier: raw, expiresAt: Date.now() + TTL };
        try { sessionStorage.setItem(key, JSON.stringify(record)); } catch { return null; }
        return record;
      }
    }
  }
  storageRemove(localStorage, key);
  storageRemove(sessionStorage, key);
  return null;
}
function pruneExpiredProofs() {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      for (let index = storage.length - 1; index >= 0; index--) {
        const key = storage.key(index);
        if (!key?.startsWith(PREFIX)) continue;
        const value = storage.getItem(key);
        try {
          const record = JSON.parse(value || "null");
          if (typeof record?.expiresAt !== "number" || record.expiresAt <= Date.now()) storageRemove(storage, key);
        } catch { storageRemove(storage, key); }
      }
    } catch { /* unavailable storage */ }
  }
}
export function rememberBrowserAuthorization(state: string, verifier: string, expectedUsername?: string) {
  pruneExpiredProofs();
  const record: BrowserAuthorization = { state, verifier, expiresAt: Date.now() + TTL,
    ...(expectedUsername ? { expectedUsername } : {}) };
  const value = JSON.stringify({ verifier: record.verifier, expiresAt: record.expiresAt,
    ...(record.expectedUsername ? { expectedUsername: record.expectedUsername } : {}) });
  try { localStorage.setItem(PREFIX + state, value); }
  catch { sessionStorage.setItem(PREFIX + state, value); }
  return record;
}
/** Persist only state references, never callback codes or access tokens. */
export function rememberPendingAuthorization(record: BrowserAuthorization, selection?: string) {
  sessionStorage.setItem(PENDING, JSON.stringify({ state: record.state,
    ...(selection ? { selection } : {}) }));
}
export function readPendingAuthorization(): BrowserAuthorization | null {
  const raw = storageRead(sessionStorage, PENDING);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw);
    const record = readBrowserAuthorization(pending.state);
    if (!record) { storageRemove(sessionStorage, PENDING); return null; }
    if (typeof pending.selection === "string" && /^[a-f0-9]{64}$/.test(pending.selection))
      record.selection = pending.selection;
    return record;
  } catch { storageRemove(sessionStorage, PENDING); return null; }
}
export function clearBrowserAuthorization(state: string) {
  storageRemove(localStorage, PREFIX + state);
  storageRemove(sessionStorage, PREFIX + state);
  storageRemove(sessionStorage, PENDING);
}
