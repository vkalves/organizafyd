import type { Grant } from "./unified.ts";

export type PendingSelection = {
  state_hash: string;
  verifier_hash: string;
  user_id: string;
  expires_at: string;
  pending_grant: string;
};
export interface SelectionStore {
  insert(row: PendingSelection): Promise<void>;
  find(hash: string, proof: string, now: string): Promise<PendingSelection | null>;
  consume(row: PendingSelection, now: string): Promise<boolean>;
}
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => Array.from(bytes, v => v.toString(16).padStart(2, "0")).join("");
const digest = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
const fail = () => new Error("invalid_selection");
const aad = (row: Pick<PendingSelection, "state_hash" | "verifier_hash" | "user_id">) =>
  encoder.encode(JSON.stringify([row.state_hash, row.verifier_hash, row.user_id]));
async function encryptionKey(serverKey: string) {
  if (!serverKey) throw fail();
  const material = await crypto.subtle.digest("SHA-256", encoder.encode("dispara:ig-account-selection:v1:" + serverKey));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function createAccountSelection(grant: Grant, userId: string, verifier: string, serverKey: string, store: SelectionStore) {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(32)));
  const row: PendingSelection = {
    state_hash: await digest("selection:" + nonce),
    verifier_hash: await digest(verifier),
    user_id: userId,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    pending_grant: "",
  };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(row) }, await encryptionKey(serverKey), encoder.encode(JSON.stringify(grant)));
  row.pending_grant = hex(iv) + "." + hex(new Uint8Array(sealed));
  await store.insert(row);
  // Tokens stay encrypted on the server. The browser receives only a one-use nonce and profile names.
  return { selection: nonce, accounts: grant.accounts.map(({ id, username }) => ({ id, username })) };
}
/** Read a legacy selection without consuming it, so a new handler can upgrade
 * its encrypted representation before performing the transactional save. */
export async function readAccountSelection<T extends PendingSelection>(nonce: string, verifier: string, serverKey: string,
  store: { find(hash: string, proof: string, now: string): Promise<T | null> }) {
  if (typeof nonce !== "string" || !/^[a-f0-9]{64}$/.test(nonce) || typeof verifier !== "string" || !/^[a-f0-9]{64}$/.test(verifier)) throw fail();
  const stateHash = await digest("selection:" + nonce), proofHash = await digest(verifier);
  const row = await store.find(stateHash, proofHash, new Date().toISOString());
  if (!row || row.state_hash !== stateHash || row.verifier_hash !== proofHash || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) throw fail();
  let grant: Grant;
  try {
    const parts = row.pending_grant.split(".");
    if (parts.length !== 2 || !/^[a-f0-9]{24}$/.test(parts[0]) || !/^(?:[a-f0-9]{2}){16,131072}$/.test(parts[1])) throw fail();
    const bytes = (s: string) => Uint8Array.from(s.match(/../g)!, pair => parseInt(pair, 16));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(parts[0]), additionalData: aad(row) }, await encryptionKey(serverKey), bytes(parts[1]));
    grant = JSON.parse(new TextDecoder().decode(plain));
    if (!Array.isArray(grant.accounts) || !grant.accounts.length || grant.accounts.length > 500 ||
      typeof grant.token !== "string" || !grant.token || grant.accounts.some(profile =>
        typeof profile.id !== "string" || !/^\d{5,30}$/.test(profile.id) ||
        typeof profile.username !== "string" || !/^[a-zA-Z0-9._]{1,30}$/.test(profile.username))) throw fail();
  } catch { throw fail(); }
  return { row, grant };
}
export async function consumeAccountSelection(nonce: string, verifier: string, accountId: string, serverKey: string, store: SelectionStore) {
  if (typeof accountId !== "string" || !/^\d{5,30}$/.test(accountId)) throw fail();
  const { row, grant } = await readAccountSelection(nonce, verifier, serverKey, store);
  const profile = grant.accounts.find(a => a.id === accountId);
  if (!profile) throw fail();
  // Compare and delete before saving so concurrent requests cannot connect different profiles.
  if (!await store.consume(row, new Date().toISOString())) throw fail();
  return { userId: row.user_id, grant, profile };
}
