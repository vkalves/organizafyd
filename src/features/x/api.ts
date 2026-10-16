import { supabase } from "@/integrations/supabase/client";
export interface XAccount {
  id: string;
  username: string;
  name: string;
  paused: boolean;
  reconnect_required: boolean;
}
export interface XMedia {
  path: string;
  type: string;
  name: string;
}
export interface XPost {
  id: string;
  account_id: string;
  text: string;
  media: XMedia[];
  scheduled_at: string;
  status: string;
  x_post_id: string | null;
  error_code: string | null;
}
export interface XData {
  configured: boolean;
  accounts: XAccount[];
  posts: XPost[];
}
export const messages: Record<string, string> = {
  not_configured:
    "A integração precisa ser ativada no servidor. Veja as instruções de configuração.",
  reconnect_required: "Reconecte a conta do X para continuar.",
  oauth_state_invalid:
    "A conexão expirou. Clique em conectar e tente novamente.",
  oauth_denied: "A conexão não foi autorizada no X.",
  permission_required:
    "Confira as permissões do aplicativo no X e reconecte a conta.",
  account_busy:
    "A conta está processando uma postagem. Aguarde e tente novamente.",
  rate_limited:
    "O X atingiu um limite de uso. Confira o acesso antes de agendar novamente.",
  credits_required: "Confira os créditos e a cobrança da API no painel do X.",
  confirmation_required:
    "Confira o perfil no X antes de agendar novamente: a publicação pode ter sido enviada.",
  media_timeout: "O envio da mídia demorou demais. Tente um arquivo menor.",
  media_failed:
    "O X não conseguiu processar a mídia. Confira o formato do arquivo.",
  invalid_media:
    "Use até 4 fotos JPG/PNG de até 5 MB cada ou 1 vídeo MP4 de até 20 MB.",
  invalid_text: "O texto ultrapassa o limite de 280 caracteres do X.",
  invalid_schedule:
    "Escolha um horário com pelo menos 1 minuto de antecedência, dentro de um ano.",
  empty_post: "Adicione um texto, uma foto ou um vídeo.",
  post_changed: "A postagem já mudou de estado. Atualize a lista.",
  x_rejected:
    "O X recusou a postagem. Confira o conteúdo e as permissões antes de agendar novamente.",
  x_unavailable: "O X está indisponível. Tente novamente mais tarde.",
};
export const errorMessage = (code: string) =>
  messages[code] ||
  "Não foi possível concluir. Atualize a página e tente novamente.";
export async function xRequest<T = { success: boolean }>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("x-publisher", {
    body: { action, ...payload },
  });
  if (error) {
    let code = "";
    if (error.context instanceof Response) {
      try {
        code = (await error.context.clone().json()).error;
      } catch {
        /* Generic public error. */
      }
    }
    throw new Error(errorMessage(code));
  }
  if (!data || data.error) throw new Error(errorMessage(data?.error));
  return data as T;
}
export async function uploadFiles(
  files: File[],
  userId: string,
): Promise<XMedia[]> {
  if (
    files.length > 4 ||
    (files.some((f) => f.type === "video/mp4") && files.length !== 1) ||
    files.some(
      (f) =>
        !["image/jpeg", "image/png", "video/mp4"].includes(f.type) ||
        f.size > (f.type === "video/mp4" ? 20 : 5) * 1024 * 1024,
    )
  )
    throw new Error(messages.invalid_media);
  const result: XMedia[] = [];
  for (const file of files) {
    const ext =
      file.type === "image/jpeg"
        ? "jpg"
        : file.type === "image/png"
          ? "png"
          : "mp4";
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("x-media")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error)
      throw new Error(
        "Não foi possível enviar o arquivo. Confira a conexão e tente novamente.",
      );
    result.push({ path, type: file.type, name: file.name });
  }
  return result;
}
