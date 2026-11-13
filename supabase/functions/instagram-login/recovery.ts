// TypeScript / recovery.ts / Supabase Edge + Vitest / durable OAuth operation support
import type { Grant, Profile } from "./unified.ts";
export type ExpectedIdentity = { expected_username: string | null; expected_graph_id: string | null };
export type RecoveryStatus = "pending" | "processing" | "selection_required" | "completed" | "restart_required";
export type ConnectionResult = { username: string } | { selection: string; accounts: { id: string; username: string }[] };
export type RecoveryRow = ExpectedIdentity & {
  state_hash: string; verifier_hash: string; user_id: string; meta_app_id: string | null;
  expires_at: string; operation_status: RecoveryStatus; operation_updated_at: string;
  selection_hash: string | null; selected_graph_id: string | null;
  pending_grant: string | null; operation_result: ConnectionResult | null;
};
const encoder = new TextEncoder();
export const hex = (bytes: Uint8Array) => Array.from(bytes, v => v.toString(16).padStart(2,"0")).join("");
export const digest = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(value))));
export function expectedIdentity(username: unknown, id: unknown): ExpectedIdentity {
  let expected_username: string | null = null, expected_graph_id: string | null = null;
  if(username != null && username !== "") {
    if(typeof username !== "string") throw new Error("invalid_expected_account");
    expected_username=username.trim().replace(/^@/,"").toLowerCase();
    if(!/^[a-z0-9._]{1,30}$/.test(expected_username)) throw new Error("invalid_expected_account");
  }
  if(id != null && id !== "") {
    if(typeof id !== "string" || !/^\d{5,30}$/.test(id)) throw new Error("invalid_expected_account");
    expected_graph_id=id;
  }
  return {expected_username,expected_graph_id};
}
export function assertExpectedIdentity(expected: ExpectedIdentity, profile: Profile): void {
  if(!profile || typeof profile.username!=="string" || typeof profile.id!=="string") throw new Error("invalid_token");
  if((expected.expected_username && expected.expected_username!==profile.username.toLowerCase()) ||
      (expected.expected_graph_id && expected.expected_graph_id!==profile.id)) throw new Error("account_mismatch");
}
function aad(row: Pick<RecoveryRow,"state_hash"|"verifier_hash"|"user_id"|"expected_username"|"expected_graph_id">) {
  return encoder.encode(JSON.stringify(["ig-oauth-recovery:v1",row.state_hash,row.verifier_hash,row.user_id,row.expected_username,row.expected_graph_id]));
}
async function encryptionKey(serverKey: string) {
  if(!serverKey) throw new Error("invalid_state");
  const key=await crypto.subtle.digest("SHA-256",encoder.encode("avanca:ig-oauth-recovery:v1:"+serverKey));
  return crypto.subtle.importKey("raw",key,"AES-GCM",false,["encrypt","decrypt"]);
}
export async function sealGrant(grant: Grant,row: RecoveryRow,key: string): Promise<string> {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:aad(row)},await encryptionKey(key),encoder.encode(JSON.stringify(grant)));
  return hex(iv)+"."+hex(new Uint8Array(cipher));
}
export async function openGrant(row: RecoveryRow,key:string): Promise<Grant> {
  try {
    const parts=(row.pending_grant||"").split(".");
    if(parts.length!==2||!/^[a-f0-9]{24}$/.test(parts[0])||!/^(?:[a-f0-9]{2}){16,131072}$/.test(parts[1]))throw new Error();
    const bytes=(s:string)=>Uint8Array.from(s.match(/../g)!,pair=>parseInt(pair,16));
    const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:bytes(parts[0]),additionalData:aad(row)},await encryptionKey(key),bytes(parts[1]));
    const grant=JSON.parse(new TextDecoder().decode(plain));
    if(!Array.isArray(grant.accounts)||typeof grant.token!=="string"||!grant.accounts.length)throw new Error();
    return grant;
  }catch{throw new Error("invalid_state");}
}
export function publicRecovery(row: RecoveryRow): {status: RecoveryStatus;result?: ConnectionResult} {
  const result=row.operation_result;
  if(row.operation_status==="completed") {
    if(!result||!("username"in result)||typeof result.username!=="string")throw new Error("invalid_state");
    return {status:"completed",result:{username:result.username}};
  }
  if(row.operation_status==="selection_required") {
    if(!result||!("selection"in result)||!Array.isArray(result.accounts))throw new Error("invalid_state");
    return {status:"selection_required",result:{selection:result.selection,accounts:result.accounts.map(a=>({id:a.id,username:a.username}))}};
  }
  return {status:row.operation_status};
}
export function completedResult(row: RecoveryRow, selectedId?: string): ConnectionResult | null {
  if(row.operation_status!=="completed")return null;
  if(selectedId&&row.selected_graph_id!==selectedId)throw new Error("account_mismatch");
  return publicRecovery(row).result!;
}
