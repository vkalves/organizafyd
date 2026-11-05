import { supabase } from "@/integrations/supabase/client";
import type {
  Settings,
  Photo,
} from "../../../supabase/functions/tiktok-publisher/model";
export type { Settings, Photo };
export interface Account {
  id: string;
  username: string;
  name: string;
  paused: boolean;
  reconnect_required: boolean;
}
export interface Post {
  id: string;
  account_id: string;
  settings: Settings;
  media: Photo[];
  scheduled_at: string;
  status: string;
  error_code: string | null;
  tiktok_post_id: string | null;
}
export interface Data {
  configured: boolean;
  accounts: Account[];
  posts: Post[];
}
export interface Creator {
  creator_nickname: string;
  creator_username: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
}
export const messages: Record<string, string> = {
  not_configured:
    "O administrador ainda precisa configurar o TikTok no Supabase.",
  unauthorized: "Entre novamente na sua conta.",
  account_busy: "Conta ocupada. Aguarde e tente novamente.",
  reconnect_required: "Conecte novamente esta conta ao TikTok.",
  oauth_denied: "A conexão foi cancelada no TikTok.",
  oauth_state_invalid:
    "Esta conexão expirou. Clique em Conectar conta novamente.",
  settings_changed:
    "As permissões da conta mudaram. Atualize as opções e revise a postagem.",
  account_paused: "Retome esta conta antes de agendar.",
  invalid_media: "Confira as fotos: de 1 a 35, até 4 MB por foto.",
  picture_size_check_failed:
    "O TikTok rejeitou as dimensões da foto. Adicione a foto novamente em uma nova postagem para preparar uma cópia menor.",
  photo_pull_failed:
    "O TikTok não conseguiu baixar a foto. Verifique a entrega da imagem antes de reenviar.",
  invalid_date: "Escolha um horário futuro.",
  consent_required: "Revise e autorize o envio.",
  commercial_required: "Informe qual marca é promovida.",
  unaudited_client_can_only_post_to_private_accounts:
    "O TikTok ainda não liberou posts públicos deste aplicativo. Use uma conta privada para o teste.",
  privacy_level_option_mismatch: "Atualize as opções de privacidade da conta.",
  url_ownership_unverified:
    "O administrador precisa verificar o domínio das fotos no TikTok.",
  spam_risk_too_many_posts:
    "O TikTok atingiu o limite de publicações desta conta.",
  rate_limit_exceeded: "O TikTok pediu uma pausa. Tente novamente mais tarde.",
  confirmation_required:
    "Confira o perfil do TikTok antes de criar outra postagem: o envio pode ter sido aceito.",
  post_changed: "Esta postagem já começou a ser enviada ou foi cancelada.",
};
export async function ttRequest<T = unknown>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error(messages.unauthorized);
  const { data, error } = await supabase.functions.invoke("tiktok-publisher", {
    body: { action, ...body },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    let code = "";
    try {
      code = (await error.context?.json())?.error || "";
    } catch {
      /* Non-JSON network error. */
    }
    throw new Error(
      messages[code] ||
        "Não foi possível confirmar a solicitação. Atualize a fila antes de repetir.",
    );
  }
  if (data?.error)
    throw new Error(messages[data.error] || `TikTok: ${data.error}`);
  return data as T;
}
export async function preparePhoto(file: File): Promise<File> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error(
      "Use JPG, PNG ou WebP com até 20 MB por arquivo de entrada.",
    );
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    if (
      bitmap.width * bitmap.height > 40000000 ||
      !bitmap.width ||
      !bitmap.height
    )
      throw new Error("A imagem deve ter até 40 megapixels.");
    // TikTok documents a maximum of 1080p for photos. Keep both axes
    // within 1080 px conservatively, preserving aspect ratio without cropping.
    const scale = Math.min(1, 1080 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Seu navegador não conseguiu preparar a foto.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (v) => (v ? resolve(v) : reject(new Error("Falha ao preparar foto."))),
        "image/jpeg",
        0.93,
      ),
    );
    if (blob.size > 4194304)
      throw new Error("A foto preparada passou de 4 MB. Use uma imagem menor.");
    return new File([blob], "foto.jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
export async function uploadPhoto(path: string, file: File) {
  const { error } = await supabase.storage
    .from("tiktok-media")
    .upload(path, file, {
      upsert: false,
      contentType: file.type,
      cacheControl: "0",
    });
  if (
    error &&
    !["409", "Duplicate"].includes(String(error.statusCode)) &&
    error.message !== "The resource already exists"
  )
    throw new Error("Falha ao enviar a foto. Tente continuar o mesmo envio.");
}
