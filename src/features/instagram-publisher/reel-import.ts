import { supabase } from "@/integrations/supabase/client";
import { MAX_REEL_BYTES, parseReelUrl } from "../../../supabase/functions/instagram-reel-import/url";

const messages: Record<string, string> = {
  unauthorized: "Entre novamente com uma conta aprovada para importar.",
  invalid_reel_url: "Cole um link de Reel no formato https://www.instagram.com/reel/…",
  reel_too_large: "Este Reel ultrapassa o limite de 100 MB.",
  reel_unavailable: "O Instagram não disponibilizou este Reel. Ele pode estar privado, bloqueado ou temporariamente indisponível. Tente mais tarde ou envie o arquivo.",
};
export { parseReelUrl };
export async function importReelFile(url: string): Promise<File> {
  const reel = parseReelUrl(url);
  const { data, error } = await supabase.functions.invoke("instagram-reel-import", { body: { url: reel.url } });
  if (error) {
    let code = "reel_unavailable";
    try { code = (await error.context?.json())?.error || code; } catch { /* network failure */ }
    throw new Error(messages[code] || messages.reel_unavailable);
  }
  if (!(data instanceof Blob) || !data.size) throw new Error(messages.reel_unavailable);
  if (data.size > MAX_REEL_BYTES) throw new Error(messages.reel_too_large);
  return new File([data], `reel-${reel.shortcode}.mp4`, { type: "video/mp4", lastModified: 0 });
}
