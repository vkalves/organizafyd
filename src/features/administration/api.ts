import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export interface UserAccess {
  is_admin: boolean;
  connected_accounts: number;
  connection_allowed: boolean;
  max_accounts: number | null;
}
export interface ManagedUser extends UserAccess {
  id: string;
  email: string | null;
  display_name: string;
  created_at: string;
  updated_at: string | null;
}
export interface UserDirectory {
  users: ManagedUser[];
  total: number;
  summary: { users: number; accounts: number; blocked: number };
}
const messages: Record<string, string> = {
  unauthorized: "Entre novamente para continuar.",
  forbidden: "Esta área é exclusiva de administradores.",
  invalid_limit: "Informe um limite inteiro entre 0 e 10.000 ou escolha Sem limite.",
  user_not_found: "Este usuário não está mais cadastrado.",
};
export async function adminRequest<T>(action: string, values: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("app-admin", { body: { action, ...values } });
  if (error) {
    let code = "";
    try { code = (await error.context?.json())?.error; } catch { /* connection failure */ }
    throw new Error(messages[code] || "Não foi possível carregar ou salvar as permissões. Tente novamente.");
  }
  if (data?.error) throw new Error(messages[data.error] || "Não foi possível concluir a solicitação.");
  return data;
}
export function useAdministrationAccess() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["avanca-access", user?.id],
    queryFn: () => adminRequest<UserAccess>("access"),
    enabled: !!user,
    staleTime: 30_000,
    retry: false,
  });
}
