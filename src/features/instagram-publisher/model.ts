export type Format = "Feed" | "Reel" | "Story" | "Carrossel";
export type Post = {
  id: string;
  user_id: string;
  account_id: string;
  caption: string;
  format: Format;
  media_urls: string[];
  scheduled_at: string | null;
  status:
    | "draft"
    | "waiting_integration"
    | "cancelled"
    | "scheduled"
    | "processing"
    | "published"
    | "failed"
    | "uncertain";
  source?: "draft" | "job";
  error_code?: string | null;
  media_id?: string | null;
  created_at: string;
  updated_at: string;
};
export function validatePost(
  post: Pick<
    Post,
    "account_id" | "caption" | "format" | "media_urls" | "scheduled_at"
  >,
  queue: boolean,
  now = Date.now(),
) {
  if (!post.account_id) throw new Error("Selecione uma conta.");
  if (post.caption.length > 2200)
    throw new Error("Use até 2.200 caracteres na legenda.");
  const max = post.format === "Carrossel" ? 10 : 1;
  if (post.media_urls.length > max)
    throw new Error(`Use até ${max} mídias neste formato.`);
  for (const value of post.media_urls) {
    let url: URL;
    if (value.startsWith("storage://")) continue;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Informe URLs de mídia válidas.");
    }
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("Use URLs HTTPS sem credenciais.");
  }
  if (
    queue &&
    (!post.media_urls.length ||
      (post.format === "Carrossel" && post.media_urls.length < 2))
  )
    throw new Error(
      "Adicione a mídia; carrosséis precisam de pelo menos duas.",
    );
  if (post.scheduled_at && !Number.isFinite(Date.parse(post.scheduled_at)))
    throw new Error("Informe uma data válida.");
  if (queue && (!post.scheduled_at || Date.parse(post.scheduled_at) <= now))
    throw new Error("Escolha um horário futuro.");
}
