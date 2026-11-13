// Compatibility for unexpired account choices created by the pre-recovery handler.
import { readAccountSelection } from "./account-selection.ts";
import { digest, expectedIdentity, sealGrant, type RecoveryRow } from "./recovery.ts";

export interface LegacySelectionStore {
  findLegacy(hash: string, proof: string, now: string): Promise<RecoveryRow | null>;
  /** Compare status, expiry, proof, owner and the original encrypted grant. */
  upgrade(previous: RecoveryRow, next: RecoveryRow, now: string): Promise<RecoveryRow | null>;
  findCurrent(hash: string, proof: string, now: string): Promise<RecoveryRow | null>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function eligible(row: RecoveryRow | null): row is RecoveryRow & { pending_grant: string } {
  return !!row && row.operation_status === "pending" && row.selection_hash === null &&
    typeof row.pending_grant === "string" && row.pending_grant.length > 0;
}
function validateCurrent(row: RecoveryRow | null, hash: string, proof: string): RecoveryRow | null {
  return row && row.state_hash === hash && row.selection_hash === hash && row.verifier_hash === proof &&
    Number.isFinite(Date.parse(row.expires_at)) && Date.parse(row.expires_at) > Date.now() ? row : null;
}
/** This upgrades storage only; it neither consumes a choice nor saves an account. */
export async function upgradeLegacySelection(nonce: string, verifier: string, serverKey: string,
  store: LegacySelectionStore): Promise<RecoveryRow | null> {
  if (typeof nonce !== "string" || !/^[a-f0-9]{64}$/.test(nonce) ||
    typeof verifier !== "string" || !/^[a-f0-9]{64}$/.test(verifier)) throw new Error("invalid_selection");
  const hash = await digest("selection:" + nonce), proof = await digest(verifier);
  const previous = await store.findLegacy(hash, proof, new Date().toISOString());
  if (!eligible(previous)) return null;
  const { grant } = await readAccountSelection(nonce, verifier, serverKey, {
    async find() { return previous; },
  });
  const appId = previous.meta_app_id ?? grant.metaAppId ?? null;
  if ((appId !== null && (typeof appId !== "string" || !UUID.test(appId))) ||
    (previous.meta_app_id && grant.metaAppId && previous.meta_app_id !== grant.metaAppId)) throw new Error("invalid_selection");
  // Preserve server-bound constraints; callback/client input cannot introduce replacements.
  const expected = expectedIdentity(previous.expected_username, previous.expected_graph_id);
  const next: RecoveryRow = {
    ...previous, ...expected, meta_app_id: appId,
    operation_status: "selection_required", operation_updated_at: new Date().toISOString(),
    selection_hash: hash, selected_graph_id: null,
    operation_result: { selection: nonce, accounts: grant.accounts.map(({ id, username }) => ({ id, username })) },
  };
  next.pending_grant = await sealGrant(grant, next, serverKey);
  const upgraded = await store.upgrade(previous, next, new Date().toISOString());
  // Another new request may already have upgraded/claimed/completed this same choice.
  // An old request may have consumed it: no row then means no duplicate operation.
  return validateCurrent(upgraded ?? await store.findCurrent(hash, proof, new Date().toISOString()), hash, proof);
}
