import { supabase } from "@/integrations/supabase/client";
const messages: Record<string, string> = {
  account_mismatch: "A conta autorizada não corresponde ao Instagram esperado. Entre na conta correta e gere uma nova autorização.",
  invalid_expected_account: "Informe um @ válido para a conta esperada.",
  authorization_restart_required: "Esta autorização precisa ser iniciada novamente com um novo link.",
  invalid_expected_identity: "Informe um @ válido para a conta esperada.",
  operation_in_progress: "A autorização está sendo processada. Verifique o resultado antes de tentar novamente.",
  restart_required: "Esta autorização precisa ser iniciada novamente com um novo link.",
  account_connection_disabled: "O administrador não liberou novas conexões para seu usuário.",
  account_limit_reached: "Você atingiu o limite de contas permitido. Solicite um aumento ao administrador.",
  app_exists: "Você já cadastrou um app com esse App ID.",
  app_not_found: "Este app não está disponível. Escolha um app ativo e gere um novo link.",
  app_in_use: "Este app tem contas vinculadas. Você pode desativá-lo; para mudar o App ID ou o tipo de login, adicione outro app.",
  professional_required: "Use uma conta profissional do Instagram: Business ou Creator.",
  forbidden: "Somente administradores podem alterar o aplicativo Meta.",
  unauthorized: "Entre novamente na Avança para continuar.",
  invalid_config_id: "Informe o Config ID numérico do Login Unificado (5 a 40 dígitos).",
  invalid_app_config: "Preencha o nome, o App ID numérico e o Secret de 32 caracteres.",
  app_secret_required: "Informe o App Secret ao trocar o App ID.",
  invalid_token:
    "A Meta retornou um acesso incompatível. Gere outro link e autorize com a configuração de login unificado.",
  business_missing:
    "Selecione o portfólio empresarial que possui o Instagram durante a autorização.",
  no_instagram_accounts:
    "A Meta não retornou nenhum Instagram autorizado. Confira o perfil profissional e o portfólio escolhido e solicite um novo link.",
  multiple_instagram_accounts:
    "Autorize apenas o Instagram que deseja conectar. Solicite um novo link e selecione um único perfil.",
  not_configured:
    "A conexão com o Instagram ainda não está configurada no servidor.",
  invalid_invite: "Este link expirou ou já foi usado. Solicite um novo link.",
  invalid_state:
    "Esta autorização expirou ou foi aberta em outro navegador. Solicite um novo link.",
  invalid_selection:
    "Esta escolha expirou ou já foi usada. Volte à Avança e gere um novo link para conectar o perfil.",
  missing_permission: "Autorize o acesso ao perfil e à publicação de conteúdo.",
  provider_conflict:
    "Este perfil já usa outra conexão. Entre em contato com o administrador para migrar o acesso.",
  account_already_connected:
    "Este perfil já pertence a outro usuário da plataforma.",
  meta_authorization_failed:
    "A Meta não concluiu a autorização. Confira a configuração do aplicativo e tente com um novo link.",
};
export async function loginRequest<T>(
  action: string,
  values: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("instagram-login", {
    body: { action, ...values },
  });
  if (error) {
    let code = "";
    try {
      code = (await error.context?.json())?.error;
    } catch {
      /* network */
    }
    throw new Error(
      messages[code] || "Não foi possível concluir a conexão. Tente novamente.",
    );
  }
  if (data?.error)
    throw new Error(messages[data.error] || "Não foi possível concluir.");
  return data;
}
