import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { validatePost, type Post } from "./model";
import { cleanMedia } from '@/features/x/clean-media';
type PublisherAccount = { id: string; user_id: string; username: string };
type Schema = {
  public: {
    Tables: {
      instagram_accounts: {
        Row: PublisherAccount;
        Insert: Partial<PublisherAccount>;
        Update: Partial<PublisherAccount>;
        Relationships: [];
      };
      instagram_publication_drafts: {
        Row: { [K in keyof Post]: Post[K] };
        Insert: Partial<Post>;
        Update: Partial<Post>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
const db = supabase as unknown as SupabaseClient<Schema>;
export type Connection = {
  account_id: string;
  paused: boolean;
  reconnect_required: boolean;
};
const messages: Record<string, string> = {
  invalid_campaign: 'Revise o tamanho dos lotes e o descanso da campanha.',
  no_unused_media: 'Todas as mídias selecionadas já foram usadas ou reservadas nessas contas. Escolha outras mídias ou desative a proteção contra repetição.',
  media_already_used: 'Uma mídia foi reservada por outro fluxo. Atualize a seleção e tente novamente.',
  publication_needs_review: 'Revise as publicações com falha ou resultado incerto antes de retomar. Nenhum reenvio será feito automaticamente.',
  campaign_stopped: 'Esta campanha foi encerrada. Crie uma nova campanha para publicar novamente.',
  invalid_gap: 'O intervalo mínimo entre mídias da mesma conta é de 3 minutos.',
  invalid_flow: 'Revise os dados do fluxo.',
  invalid_accounts: 'Selecione ao menos uma conta.',
  flow_too_large: 'Crie fluxos com até 500 publicações por vez.',
  invalid_caption: 'Cada legenda deve ter até 2.200 caracteres.',
  invalid_media: 'Selecione ao menos uma mídia da biblioteca.',
  use_instagram_login: "Use Conectar conta → Conectar meu Instagram para renovar este acesso.",
  missing_publish_permission:
    "Gere um token de usuário com instagram_basic e instagram_content_publish autorizadas para esta conta.",
  invalid_connection: "Cole um token de acesso válido da Meta.",
  invalid_instagram_id:
    "Informe o ID numérico da conta profissional do Instagram, não o ID do aplicativo ou da Página.",
  account_already_connected:
    "Este perfil já está conectado a outro usuário do site.",
  meta_100:
    "A Meta não encontrou esse perfil ou não permitiu o acesso. Confira o ID e as permissões do token.",
  meta_10:
    "O token não tem as permissões necessárias. Gere um token com acesso ao perfil e à publicação no Instagram.",
  meta_200:
    "A Meta não autorizou o acesso. Confira as permissões do token e o vínculo entre a Página e o Instagram.",
  account_not_connected: "Reconecte sua conta antes de agendar.",
  invalid_schedule: "Escolha uma data futura.",
  invalid_media_format:
    "Use JPG no Feed e Carrossel; MP4 nos Reels; JPG ou MP4 nos Stories.",
  invalid_media_owner: "Esta mídia não pertence à sua conta.",
  cannot_cancel: "A postagem já está em processamento ou foi encerrada.",
  meta_190: "Token expirado ou inválido. Atualize a conexão.",
  duplicate_conflict: "Este rascunho já foi agendado. Atualize a fila.",
};
export async function publisherRequest<T = { ok: boolean }>(
  action: string,
  values: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(
    "instagram-publisher",
    { body: { action, ...values } },
  );
  if (error) {
    let code = "request_failed";
    try {
      code = (await error.context?.json())?.error || code;
    } catch {
      /* no JSON */
    }
    throw new Error(
      messages[code] ||
        "Não foi possível concluir. Verifique sua conexão e tente novamente.",
    );
  }
  if (data?.error)
    throw new Error(messages[data.error] || "Não foi possível concluir.");
  return data;
}
export async function connections() {
  return (await publisherRequest<{ accounts: Connection[] }>("status"))
    .accounts;
}
export async function listPosts(userId: string): Promise<Post[]> {
  const drafts = await db
    .from("instagram_publication_drafts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (drafts.error) throw new Error("Não foi possível carregar os rascunhos.");
  const jobsDb = supabase as unknown as SupabaseClient<{
    public: {
      Tables: {
        ig_publication_jobs: {
          Row: { [K in keyof Post]: Post[K] };
          Insert: Partial<Post>;
          Update: Partial<Post>;
          Relationships: [];
        };
      };
      Views: Record<string, never>;
      Functions: Record<string, never>;
    };
  }>;
  const jobs = await jobsDb
    .from("ig_publication_jobs")
    .select(
      "id,user_id,account_id,caption,format,media_urls,scheduled_at,status,created_at,published_at,error_code,media_id,flow_id",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (jobs.error) throw new Error("Não foi possível carregar a fila.");
  const ids = new Set(jobs.data.map((p) => p.id));
  return [
    ...(drafts.data as unknown as Post[])
      .filter((p) => !ids.has(p.id))
      .map((p) => ({ ...p, source: "draft" as const })),
    ...jobs.data.map((p) => ({ ...p, source: "job" as const })),
  ]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 200) as Post[];
}
export async function savePost(post: Omit<Post, "created_at" | "updated_at">) {
  const clean = post;
  validatePost(post, post.status === "scheduled");
  if (post.status === "scheduled") {
    await publisherRequest("schedule", { post: clean });
    return;
  }
  const { error } = await db.from("instagram_publication_drafts").upsert(clean);
  if (error) throw new Error("Não foi possível salvar o rascunho.");
}
export async function cancelPost(post: Post, userId: string) {
  if (post.source === "job") {
    await publisherRequest("cancel", { id: post.id });
    return;
  }
  const { data, error } = await db
    .from("instagram_publication_drafts")
    .update({ status: "cancelled" })
    .eq("id", post.id)
    .eq("user_id", userId)
    .neq("status", "cancelled")
    .select("id");
  if (error || !data?.length)
    throw new Error(
      "Não foi possível cancelar. Atualize a lista e tente novamente.",
    );
}
export async function listAccounts(
  userId: string,
): Promise<PublisherAccount[]> {
  const links = await connections();
  if (!links.length) return [];
  const { data, error } = await db
    .from("instagram_accounts")
    .select("id,user_id,username")
    .eq("user_id", userId)
    .in(
      "id",
      links.map((c) => c.account_id),
    )
    .order("username");
  if (error) throw new Error("Não foi possível carregar as contas.");
  return data;
}
export async function uploadMedia(
  files: File[],
  userId: string,
): Promise<string[]> {
  const result: string[] = [];
  for (const file of files) {
    const cleaned = await cleanMedia(file, { maxBytes: 100 * 1024 * 1024, jpeg: true });
    const ext =
      cleaned.type === "image/jpeg"
        ? "jpg"
        : cleaned.type === "video/mp4"
          ? "mp4"
          : null;
    if (!ext || file.size > 100 * 1024 * 1024)
      throw new Error("Use JPG ou MP4, com até 100 MB por arquivo.");
    const path = userId + "/" + crypto.randomUUID() + "." + ext;
    const { error } = await supabase.storage
      .from("instagram-publisher")
      .upload(path, cleaned, { contentType: cleaned.type, upsert: false });
    if (error) throw new Error("Falha no upload. Tente novamente.");
    result.push("storage://" + path);
  }
  return result;
}
