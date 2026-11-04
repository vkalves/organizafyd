import { supabase } from '@/integrations/supabase/client';
export type HealthState = 'unknown' | 'healthy' | 'reconnect' | 'permissions' | 'unavailable' | 'temporary';
export type AccountHealth = { account_id: string; state: HealthState; checked_at: string | null; last_healthy_at: string | null; error_code: string | null };
export type AccountAlert = { id: string; account_id: string; state: HealthState; created_at: string; read_at: string | null; resolved_at: string | null };
export type MonitorData = { health: AccountHealth[]; alerts: AccountAlert[] };
export const healthLabels: Record<HealthState, string> = { unknown: 'Aguardando verificação', healthy: 'Conexão ativa', reconnect: 'Reconexão necessária', permissions: 'Permissão removida', unavailable: 'Perfil inacessível pela API', temporary: 'Falha temporária da API' };
export const healthDetails: Record<HealthState, string> = {
 unknown: 'A primeira verificação será feita automaticamente.', healthy: 'O perfil respondeu à última verificação.',
 reconnect: 'O acesso expirou ou foi revogado. Reconecte o Instagram; isso não confirma que a conta foi derrubada.',
 permissions: 'A Meta recusou as permissões. Revise a autorização da conta.',
 unavailable: 'O perfil não pôde ser consultado em verificações consecutivas. Confira no Instagram se houve restrição, desativação ou mudança de acesso.',
 temporary: 'Houve falhas repetidas de rede ou limite da Meta. Vamos verificar novamente; isso não significa conta derrubada.',
};
export async function monitorRequest(action = 'status', id?: string): Promise<MonitorData> {
 const { data, error } = await supabase.functions.invoke('instagram-monitor', { body: { action, id } });
 if (error || data?.error) throw new Error('Não foi possível atualizar o monitoramento.');
 return data;
}
