import { supabase } from "@/integrations/supabase/client";
const messages: Record<string, string> = {
  invalid_token:
    "A Meta retornou um acesso incompatível. Gere outro link e autorize com a configuração de login unificado.",
  business_missing:
    "Selecione o portfólio empresarial que possui o Instagram durante a autorização.",
  no_instagram_accounts:
    "A Meta não retornou nenhum Instagram autorizado. Confira o perfil profissional e o portfólio escolhido e solicite um novo link.",
  multiple_instagram_accounts:
    "Autorize apenas o Instagram que deseja conectar. Solicite um novo link e selecione um único perfil.",
  not_configured:
    "A conexão direta aguarda a configuração do aplicativo Meta pelo administrador.",
  invalid_invite: "Este link expirou ou já foi usado. Solicite um novo link.",
  invalid_state:
    "Esta autorização expirou ou foi aberta em outro navegador. Solicite um novo link.",
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
