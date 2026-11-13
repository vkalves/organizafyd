// TypeScript / automation-api.ts / browser / verified AVANÇA account-to-flow adapter
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { adminRequest } from "@/features/administration/api";
import { publisherRequest } from "./api";

export type AutomationAccount = { id: string; user_id: string; username: string };
export type AutomationConnection = { account_id: string; paused: boolean; reconnect_required: boolean };
export type AutomationFlow = {
  id: string;
  user_id: string;
  name: string;
  state: string;
  settings: { accountIds?: string[] };
};
export type ExpectedInstagramAccount = {
  /** The handle observed on Android and in Chrome. Never infer it from the first OAuth result. */
  expectedUsername: string;
  /** Meta account ID within the selected app/provider; not an instagram_accounts UUID. */
  expectedGraphId?: string;
  /** Explicitly chosen internal account UUID, if more than one saved record matches the handle. */
  accountId?: string;
};
export type VerifiedAutomationAccount = {
  userId: string;
  accountId: string;
  graphId: string;
  username: string;
};
export type FlowIntegrationResult = VerifiedAutomationAccount & {
  flowId: string;
  flowName: string;
  alreadyAssociated: boolean;
  recoveredAfterWriteError: boolean;
  /** Counts returned by the write; null when success was established by readback only. */
  added: number | null;
  queued: number | null;
};
export interface AutomationDependencies {
  authenticatedUser(): Promise<{ id: string } | null>;
  access(): Promise<{ account_status: string }>;
  connections(): Promise<AutomationConnection[]>;
  accounts(userId: string, ids: string[]): Promise<AutomationAccount[]>;
  verify(accountId: string): Promise<{ id: string; username: string }>;
  flow(userId: string, flowId: string): Promise<AutomationFlow | null>;
  addFlowAccount(flowId: string, accountId: string): Promise<{ added: number; queued?: number }>;
}
export type AutomationErrorCode =
  | "INVALID_INPUT" | "UNAUTHENTICATED" | "ACCOUNT_NOT_APPROVED" | "PREFLIGHT_UNAVAILABLE"
  | "ACCOUNT_NOT_CONNECTED" | "AMBIGUOUS_ACCOUNT" | "IDENTITY_MISMATCH" | "IDENTITY_UNAVAILABLE"
  | "FLOW_NOT_FOUND" | "FLOW_NOT_ACTIVE" | "FLOW_READBACK_UNAVAILABLE" | "FLOW_WRITE_UNCONFIRMED"
  | "SESSION_CHANGED";
const messages: Record<AutomationErrorCode, string> = {
  INVALID_INPUT: "Informe o @ esperado e os identificadores válidos da conta e do fluxo.",
  UNAUTHENTICATED: "Entre na AVANÇA antes de integrar a conta.",
  ACCOUNT_NOT_APPROVED: "A conta AVANÇA precisa estar aprovada para continuar.",
  PREFLIGHT_UNAVAILABLE: "Não foi possível verificar o acesso e as conexões. Nenhuma sincronização foi iniciada.",
  ACCOUNT_NOT_CONNECTED: "A conta esperada não está conectada e disponível neste usuário AVANÇA. Confira o perfil escolhido ou reconecte-o.",
  AMBIGUOUS_ACCOUNT: "Mais de um registro corresponde ao @ esperado. Selecione explicitamente a conta que deseja integrar.",
  IDENTITY_MISMATCH: "A identidade retornada pelo Instagram difere da conta esperada. A integração foi interrompida.",
  IDENTITY_UNAVAILABLE: "Não foi possível confirmar a identidade no Instagram. Confira a conexão antes de continuar.",
  FLOW_NOT_FOUND: "O fluxo não foi encontrado entre os fluxos deste usuário.",
  FLOW_NOT_ACTIVE: "O fluxo precisa permanecer ativo para confirmar a associação.",
  FLOW_READBACK_UNAVAILABLE: "Não foi possível conferir o resultado no fluxo. Atualize a conexão e consulte novamente antes de repetir.",
  FLOW_WRITE_UNCONFIRMED: "A sincronização não foi confirmada no fluxo. Nenhum reenvio automático foi feito; consulte o estado antes de tentar novamente.",
  SESSION_CHANGED: "A sessão AVANÇA mudou durante a operação. Entre na conta correta e confira o resultado antes de continuar.",
};
export class AutomationIntegrationError extends Error {
  readonly code: AutomationErrorCode;
  constructor(code: AutomationErrorCode) {
    super(messages[code]);
    this.name = "AutomationIntegrationError";
    this.code = code;
  }
}
const fail = (code: AutomationErrorCode): never => { throw new AutomationIntegrationError(code); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRAPH_ID = /^\d{5,40}$/;
function username(value: unknown): string {
  if (typeof value !== "string") return fail("INVALID_INPUT");
  const normalized = value.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(normalized)) return fail("INVALID_INPUT");
  return normalized;
}
function expectation(input: ExpectedInstagramAccount) {
  if (!input || typeof input !== "object") return fail("INVALID_INPUT");
  const expectedUsername = username(input.expectedUsername);
  if (input.accountId !== undefined && (typeof input.accountId !== "string" || !UUID.test(input.accountId))) return fail("INVALID_INPUT");
  if (input.expectedGraphId !== undefined && (typeof input.expectedGraphId !== "string" || !GRAPH_ID.test(input.expectedGraphId))) return fail("INVALID_INPUT");
  return Object.freeze({ expectedUsername, accountId: input.accountId, expectedGraphId: input.expectedGraphId });
}
function assertIdentity(profile: { id: string; username: string }, expectedUsername: string, expectedGraphId?: string) {
  if (!profile || typeof profile.id !== "string" || !GRAPH_ID.test(profile.id) || typeof profile.username !== "string") return fail("IDENTITY_UNAVAILABLE");
  let observed: string;
  try { observed = username(profile.username); } catch { return fail("IDENTITY_UNAVAILABLE"); }
  if (observed !== expectedUsername || (expectedGraphId !== undefined && profile.id !== expectedGraphId)) return fail("IDENTITY_MISMATCH");
  return { graphId: profile.id, username: observed };
}

/** This coordinator never creates campaigns, publishes content, or calls a privileged RPC. */
export function createAutomationAdapter(dependencies: AutomationDependencies) {
  async function assertSession(userId: string) {
    let user: { id: string } | null;
    try { user = await dependencies.authenticatedUser(); } catch { return fail("SESSION_CHANGED"); }
    if (!user || user.id !== userId) return fail("SESSION_CHANGED");
  }
  async function verifyIdentity(account: VerifiedAutomationAccount) {
    let profile: { id: string; username: string };
    try { profile = await dependencies.verify(account.accountId); } catch { return fail("IDENTITY_UNAVAILABLE"); }
    const identity = assertIdentity(profile, account.username, account.graphId);
    await assertSession(account.userId);
    return identity;
  }
  async function preflight(input: ExpectedInstagramAccount): Promise<VerifiedAutomationAccount> {
    // Freeze primitive inputs before the first await so edits cannot change an active operation.
    const expected = expectation(input);
    let user: { id: string } | null;
    try { user = await dependencies.authenticatedUser(); } catch { return fail("UNAUTHENTICATED"); }
    if (!user || typeof user.id !== "string" || !UUID.test(user.id)) return fail("UNAUTHENTICATED");
    let access: { account_status: string }, connections: AutomationConnection[], accounts: AutomationAccount[];
    try {
      access = await dependencies.access();
      if (access?.account_status !== "approved") return fail("ACCOUNT_NOT_APPROVED");
      connections = await dependencies.connections();
      if (!Array.isArray(connections)) return fail("PREFLIGHT_UNAVAILABLE");
      connections = connections.filter(c => c && typeof c.account_id === "string" && UUID.test(c.account_id) && c.paused === false && c.reconnect_required === false);
      const ids = [...new Set(connections.map(c => c.account_id))];
      if (expected.accountId && !ids.includes(expected.accountId)) return fail("ACCOUNT_NOT_CONNECTED");
      if (!ids.length) return fail("ACCOUNT_NOT_CONNECTED");
      accounts = await dependencies.accounts(user.id, expected.accountId ? [expected.accountId] : ids);
    } catch (error) {
      if (error instanceof AutomationIntegrationError) throw error;
      return fail("PREFLIGHT_UNAVAILABLE");
    }
    if (!Array.isArray(accounts)) return fail("PREFLIGHT_UNAVAILABLE");
    const candidates = accounts.filter(account => account && account.user_id === user.id && UUID.test(account.id)
      && connections.some(c => c.account_id === account.id && c.paused === false && c.reconnect_required === false)
      && (expected.accountId ? account.id === expected.accountId : typeof account.username === "string" && account.username.toLowerCase() === expected.expectedUsername));
    if (candidates.length === 0) return fail("ACCOUNT_NOT_CONNECTED");
    if (candidates.length !== 1) return fail("AMBIGUOUS_ACCOUNT");
    await assertSession(user.id);
    let profile: { id: string; username: string };
    try { profile = await dependencies.verify(candidates[0].id); } catch { return fail("IDENTITY_UNAVAILABLE"); }
    const identity = assertIdentity(profile, expected.expectedUsername, expected.expectedGraphId);
    await assertSession(user.id);
    return Object.freeze({ userId: user.id, accountId: candidates[0].id, ...identity });
  }
  async function readFlow(account: VerifiedAutomationAccount, flowId: string, afterWrite = false) {
    await assertSession(account.userId);
    let flow: AutomationFlow | null;
    try { flow = await dependencies.flow(account.userId, flowId); } catch { return fail("FLOW_READBACK_UNAVAILABLE"); }
    if (!flow || flow.id !== flowId || flow.user_id !== account.userId) return fail(afterWrite ? "FLOW_READBACK_UNAVAILABLE" : "FLOW_NOT_FOUND");
    if (flow.state !== "active") return fail("FLOW_NOT_ACTIVE");
    if (!flow.settings || !Array.isArray(flow.settings.accountIds) || flow.settings.accountIds.some(id => typeof id !== "string" || !UUID.test(id))) return fail("FLOW_READBACK_UNAVAILABLE");
    return flow;
  }
  async function syncToFlow(input: ExpectedInstagramAccount & { flowId: string }): Promise<FlowIntegrationResult> {
    const flowId = input?.flowId;
    if (typeof flowId !== "string" || !UUID.test(flowId)) return fail("INVALID_INPUT");
    const account = await preflight(input);
    const existing = await readFlow(account, flowId);
    if (existing.settings.accountIds!.includes(account.accountId)) {
      await verifyIdentity(account);
      return Object.freeze({ ...account, flowId, flowName: existing.name, alreadyAssociated: true, recoveredAfterWriteError: false, added: null, queued: null });
    }
    // Last identity/session check before the only mutating request. The Edge Function
    // still authorizes ownership and readiness inside its transaction.
    await verifyIdentity(account);
    let writeFailed = false, counts: { added: number; queued?: number } | null = null;
    try {
      const result = await dependencies.addFlowAccount(flowId, account.accountId);
      if (result && Number.isInteger(result.added) && result.added >= 0 && (result.queued === undefined || Number.isInteger(result.queued) && result.queued >= 0)) counts = result;
      else writeFailed = true;
    } catch { writeFailed = true; }
    // A timeout may mean the server committed. Always observe before considering a
    // retry, and never use {added} or a counter alone as evidence of association.
    const observed = await readFlow(account, flowId, true);
    if (!observed.settings.accountIds!.includes(account.accountId)) return fail("FLOW_WRITE_UNCONFIRMED");
    await verifyIdentity(account);
    return Object.freeze({ ...account, flowId, flowName: observed.name, alreadyAssociated: false, recoveredAfterWriteError: writeFailed, added: counts?.added ?? null, queued: counts?.queued ?? null });
  }
  return { preflight, syncToFlow };
}

type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };
type AutomationSchema = { public: { Tables: { instagram_accounts: Table<AutomationAccount>; ig_flows: Table<AutomationFlow> }; Views: Record<string, never>; Functions: Record<string, never> } };
const db = supabase as unknown as SupabaseClient<AutomationSchema>;
export const automationApi = createAutomationAdapter({
  async authenticatedUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user ? { id: data.user.id } : null;
  },
  access: () => adminRequest<{ account_status: string }>("access"),
  async connections() { return (await publisherRequest<{ accounts: AutomationConnection[] }>("status")).accounts; },
  async accounts(userId, ids) {
    const { data, error } = await db.from("instagram_accounts").select("id,user_id,username").eq("user_id", userId).in("id", ids);
    if (error) throw new Error("account_read_failed");
    return data;
  },
  verify: account_id => publisherRequest<{ id: string; username: string }>("verify", { account_id }),
  async flow(userId, flowId) {
    const { data, error } = await db.from("ig_flows").select("id,user_id,name,state,settings").eq("user_id", userId).eq("id", flowId).maybeSingle();
    if (error) throw new Error("flow_read_failed");
    return data;
  },
  addFlowAccount: (id, accountId) => publisherRequest<{ added: number; queued: number }>("add_flow_accounts", { id, account_ids: [accountId] }),
});
