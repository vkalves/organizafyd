import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { publisherRequest, uploadMedia } from "./api";
import type { FlowInput } from "../../../supabase/functions/instagram-publisher/flow";
export type Media = {
  id: string;
  user_id: string;
  url: string;
  kind: "posts" | "stories" | "cover";
  folder: string;
  caption: string;
  created_at: string;
  retired: boolean;
};
export type Flow = {
  id: string;
  name: string;
  created_at: string;
  settings: FlowInput;
  state?: "active" | "paused" | "stopped" | "completed";
  cycle?: number;
  last_error?: string | null;
};
type Prefs = {
  user_id: string;
  folders: string[];
  captions: string[];
  folder_captions?: Record<string, string[]>;
};
export type CampaignReport = {
  flows: { id: string; published: number; pending: number; review: number }[];
  usage: {
    account_id: string;
    media_id: string;
    published: number;
    pending: number;
    last_published_at: string | null;
  }[];
};
type Table<T> = {
  Row: { [K in keyof T]: T[K] };
  Insert: Partial<T>;
  Update: Partial<T>;
  Relationships: [];
};
type Schema = {
  public: {
    Tables: {
      ig_flow_library: Table<Media>;
      ig_flow_preferences: Table<Prefs>;
      ig_flows: Table<Flow>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
const db = supabase as unknown as SupabaseClient<Schema>;
export async function loadFlowData(userId: string) {
  const [media, prefs, flows, report] = await Promise.all([
    db
      .from("ig_flow_library")
      .select("*")
      .eq("user_id", userId)
      .eq("retired", false)
      .order("created_at"),
    db
      .from("ig_flow_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("ig_flows")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    publisherRequest<CampaignReport>("campaign_report").catch(() => null),
  ]);
  if (media.error || prefs.error || flows.error)
    throw new Error("Não foi possível carregar os Fluxos. Tente atualizar.");
  return {
    media: media.data as unknown as Media[],
    prefs: (prefs.data as unknown as Prefs | null) ?? {
      user_id: userId,
      folders: [],
      captions: [],
    },
    flows: flows.data as unknown as Flow[],
    report,
  };
}
export async function addMedia(
  files: File[],
  userId: string,
  kind: Media["kind"],
  folder: string,
  progress: (message: string) => void,
) {
  const ids: string[] = [];
  for (const [index, file] of files.entries()) {
    progress(
      `Limpando metadados e enviando mídia ${index + 1} de ${files.length}…`,
    );
    const [url] = await uploadMedia([file], userId);
    const { data, error } = await db
      .from("ig_flow_library")
      .insert({ user_id: userId, url, kind, folder })
      .select("id")
      .single();
    if (error)
      throw new Error(
        "Upload concluído, mas não foi possível registrar a mídia na biblioteca.",
      );
    ids.push(data.id);
  }
  return ids;
}
export async function setMedia(
  id: string,
  changes: Pick<Partial<Media>, "caption" | "folder">,
) {
  const { error } = await db
    .from("ig_flow_library")
    .update(changes)
    .eq("id", id);
  if (error) throw new Error("Não foi possível salvar a mídia.");
}
export async function savePrefs(prefs: Prefs) {
  const { error } = await db.from("ig_flow_preferences").upsert(prefs);
  if (error) throw new Error("Não foi possível salvar suas preferências.");
}
export const createFlow = (input: FlowInput) =>
  publisherRequest("create_flow", { flow: input });
export const controlFlow = (id: string, control: "pause" | "resume" | "stop") =>
  publisherRequest("control_flow", { id, control });
export const cancelFlow = (id: string) =>
  publisherRequest("cancel_flow", { id });
export async function previewMedia(url: string) {
  const { data, error } = await supabase.storage
    .from("instagram-publisher")
    .createSignedUrl(url.slice(10), 600);
  if (error) throw new Error("Não foi possível abrir esta mídia.");
  return data.signedUrl;
}
