import type { Post } from "./model";
import type { Flow } from "./flows-api";
import type { Connection } from "./api";
export function publicationWait(post: Post, flow?: Pick<Flow, "state" | "last_error">, connection?: Connection, now = Date.now()): string {
  if (post.status === "published") return `${post.format} publicado pela Meta.`;
  if (post.status === "uncertain") return "Confirmando resultado com a Meta. Não reenvie para evitar duplicação.";
  if (post.status === "processing") return "Preparando mídia e aguardando a Meta.";
  if (post.status === "scheduled") {
    if (connection?.reconnect_required) return "Reconecte a conta para continuar a publicação.";
    if (connection?.paused) return "Conta pausada. Retome a conta para continuar.";
    if (flow?.state === "paused") return flow.last_error === "no_available_accounts" ? "Fluxo aguardando uma conta disponível." : "Fluxo pausado. Retome o fluxo para publicar.";
    if (flow?.state === "stopped") return "Fluxo encerrado.";
    if (post.error_code === "publishing_quota_wait") return "Limite temporário da Meta. Nova tentativa automática.";
    if (post.next_attempt_at && Date.parse(post.next_attempt_at) > now) return "Aguardando nova tentativa automática.";
    if (post.error_code) return "Falha temporária. Aguardando nova tentativa automática.";
    if (post.scheduled_at && Date.parse(post.scheduled_at) < now - 120_000) return "Horário atingido. Aguardando a fila e o intervalo da conta.";
    return "Pronto para o horário agendado.";
  }
  if (post.error_code) return `Erro: ${post.error_code}`;
  return post.status === "cancelled" ? "Publicação cancelada." : "Rascunho ainda não agendado.";
}
