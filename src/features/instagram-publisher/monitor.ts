import { supabase } from "@/integrations/supabase/client";
export type HealthState =
  | "unknown"
  | "healthy"
  | "reconnect"
  | "permissions"
  | "unavailable"
  | "temporary";
export type AccountHealth = {
  account_id: string;
  state: HealthState;
  candidate?: HealthState;
  failures?: number;
  checked_at: string | null;
  last_healthy_at: string | null;
  error_code: string | null;
};
export type AccountAlert = {
  id: string;
  account_id: string;
  state: HealthState;
  created_at: string;
  read_at: string | null;
  resolved_at: string | null;
};
export type MonitorData = {
  health: AccountHealth[];
  alerts: AccountAlert[];
  history_limit?: number;
};
export type RefreshResult = { status: "checked" | "recent" | "busy" };
export const healthLabels: Record<HealthState, string> = {
  unknown: "Aguardando verificação",
  healthy: "Conexão ativa",
  reconnect: "Reconexão necessária",
  permissions: "Permissão removida",
  unavailable: "Perfil inacessível pela API",
  temporary: "Falha temporária da API",
};
export const healthDetails: Record<HealthState, string> = {
  unknown: "A primeira verificação será feita automaticamente.",
  healthy:
    "O perfil respondeu à última verificação. Isso não garante permissão para todas as formas de publicação.",
  reconnect:
    "O acesso expirou ou foi revogado. Reconecte o Instagram; isso não confirma que a conta foi derrubada.",
  permissions: "A Meta recusou as permissões. Revise a autorização da conta.",
  unavailable:
    "O perfil não pôde ser consultado em verificações consecutivas. Confira no Instagram se houve restrição, desativação ou mudança de acesso.",
  temporary:
    "Houve falhas repetidas de rede ou limite da Meta. Vamos verificar novamente; isso não significa conta derrubada.",
};
export function needsNewCheck(health?: AccountHealth, now = Date.now()) {
  const checked = health?.checked_at ? Date.parse(health.checked_at) : NaN;
  return !Number.isFinite(checked) || now - checked > 15 * 60_000;
}
export function accountHealthState(
  health?: AccountHealth,
  reconnectRequired = false,
): HealthState {
  // Connection authentication failures take precedence over an older healthy check.
  return reconnectRequired ? "reconnect" : health?.state ?? "unknown";
}
export function confirmedHealthy(
  health?: AccountHealth,
  reconnectRequired = false,
  now = Date.now(),
) {
  return !!health &&
    accountHealthState(health, reconnectRequired) === "healthy" &&
    !needsNewCheck(health, now) &&
    !(health.failures && health.candidate !== "healthy");
}
export function monitorRequest(action?: "status"): Promise<MonitorData>;
export function monitorRequest(
  action: "read" | "read_all",
  id?: string,
): Promise<{ ok: true; updated: number }>;
export function monitorRequest(
  action: "refresh",
  id: string,
): Promise<RefreshResult>;
export async function monitorRequest(
  action = "status",
  id?: string,
): Promise<MonitorData | RefreshResult | { ok: true; updated: number }> {
  const { data, error } = await supabase.functions.invoke("instagram-monitor", {
    body: { action, id },
  });
  if (error || data?.error || !data) {
    throw new Error("Não foi possível atualizar o monitoramento.");
  }
  if (
    action === "status" &&
    (!Array.isArray(data.health) || !Array.isArray(data.alerts))
  ) throw new Error("Resposta inválida do monitoramento.");
  return data;
}
