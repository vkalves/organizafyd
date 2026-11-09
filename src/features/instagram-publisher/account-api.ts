import { supabase } from "@/integrations/supabase/client";
export type AccountPhoto = { account_id: string; avatar_url: string | null };
const messages: Record<string, string> = {
  account_busy: "Há uma publicação em andamento nesta conta. Aguarde a conclusão e tente remover novamente.",
  account_not_found: "Essa conta não está mais conectada. Atualize a lista.",
  unauthorized: "Sua sessão expirou. Entre novamente para continuar.",
};
async function accountRequest<T>(action: string, values: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("instagram-accounts", { body: { action, ...values } });
  let code = data?.error as string | undefined;
  if (error) {
    try { code = (await error.context?.json())?.error; } catch { /* No JSON response. */ }
  }
  if (error || code) throw new Error(messages[code || ""] || "Não foi possível concluir. Verifique sua conexão e tente novamente.");
  return data as T;
}
export async function loadAccountPhotos(accountIds: string[], refresh = false): Promise<AccountPhoto[]> {
  const ids = [...new Set(accountIds)];
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 10) batches.push(ids.slice(i, i + 10));
  const photos: AccountPhoto[] = [];
  for (let i = 0; i < batches.length; i += 2) {
    const responses = await Promise.all(batches.slice(i, i + 2).map((account_ids) => accountRequest<{ photos: AccountPhoto[] }>("profiles", { account_ids, refresh })));
    photos.push(...responses.flatMap((response) => response.photos));
  }
  return photos;
}
export async function disconnectAccount(accountId: string): Promise<void> {
  await accountRequest("disconnect", { account_id: accountId });
}
