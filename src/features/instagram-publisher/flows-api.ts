import { storage } from '@/lib/storage';
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
type MediaReference = {
  id: string;
  user_id: string;
  media_urls: string[];
  status: string;
};
type Schema = {
  public: {
    Tables: {
      ig_flow_library: Table<Media>;
      ig_flow_preferences: Table<Prefs>;
      ig_flows: Table<Flow>;
      ig_publication_jobs: Table<MediaReference>;
      instagram_publication_drafts: Table<MediaReference>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
const db = supabase as unknown as SupabaseClient<Schema>;
const DELETED_FLOWS_FIELD = "__deleted_flows__";

function deletedFlowsStorageKey(userId: string): string {
  return `organizafy:deleted_flows:${userId}`;
}

function readLocalDeletedFlowIds(userId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(deletedFlowsStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function writeLocalDeletedFlowIds(userId: string, ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      deletedFlowsStorageKey(userId),
      JSON.stringify([...new Set(ids)]),
    );
  } catch {
    // Ignore storage quota errors
  }
}

function getDeletedFlowIdsSet(userId: string, prefs?: Prefs | null): Set<string> {
  const fromPrefs = Array.isArray(prefs?.folder_captions?.[DELETED_FLOWS_FIELD])
    ? (prefs!.folder_captions![DELETED_FLOWS_FIELD] as string[])
    : [];
  const fromLocal = readLocalDeletedFlowIds(userId);
  return new Set([...fromPrefs, ...fromLocal]);
}

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
  const loadedPrefs = (prefs.data as unknown as Prefs | null) ?? {
    user_id: userId,
    folders: [],
    captions: [],
  };
  const deletedIds = getDeletedFlowIdsSet(userId, loadedPrefs);
  if (deletedIds.size > 0) {
    writeLocalDeletedFlowIds(userId, [...deletedIds]);
  }
  const visibleFlows = ((flows.data as unknown as Flow[]) ?? []).filter(
    (flow) => !deletedIds.has(flow.id),
  );
  const filteredReport = report
    ? {
        ...report,
        flows: (report.flows ?? []).filter((f) => !deletedIds.has(f.id)),
      }
    : null;
  return {
    media: media.data as unknown as Media[],
    prefs: loadedPrefs,
    flows: visibleFlows,
    report: filteredReport,
  };
}
export type UploadItemState = {
  index: number;
  name: string;
  status: "pending" | "processing" | "done" | "error";
  message: string;
};
const MEDIA_UPLOAD_CONCURRENCY = 3;
export async function addMedia(
  files: File[],
  userId: string,
  kind: Media["kind"],
  folder: string,
  progress: (message: string) => void,
  callbacks?: {
    onSaved?: (media: Media) => void;
    onItem?: (item: UploadItemState) => void;
  },
) {
  const savedMedia: (Media | undefined)[] = Array(files.length);
  const errors: ({ name: string; message: string } | undefined)[] = Array(
    files.length,
  );
  let nextIndex = 0;

  async function uploadOne(index: number) {
    const file = files[index];
    const notify = (
      message: string,
      status: UploadItemState["status"] = "processing",
    ) => {
      progress(`${index + 1}/${files.length} · ${message}`);
      callbacks?.onItem?.({ index, name: file.name, status, message });
    };
    try {
      // Give the browser a paint/input opportunity before starting each file.
      await new Promise((resolve) => setTimeout(resolve, 0));
      notify("Preparando limpeza…");
      const [url] = await uploadMedia([file], userId, notify);
      notify("Registrando na biblioteca…");
      const { data, error } = await db
        .from("ig_flow_library")
        .insert({ user_id: userId, url, kind, folder })
        .select("*")
        .single();
      if (error)
        throw new Error(
          "Arquivo enviado, mas não foi possível registrá-lo na biblioteca. Tente novamente.",
        );
      const saved = data as unknown as Media;
      if (!saved?.id)
        throw new Error("A biblioteca não confirmou o registro desta mídia.");
      savedMedia[index] = saved;
      callbacks?.onSaved?.(saved);
      notify("Pronta para publicar", "done");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível processar o arquivo.";
      errors[index] = { name: file.name, message };
      notify(message, "error");
      // A malformed file must not discard completed uploads or skip the rest.
    }
  }

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= files.length) return;
      await uploadOne(index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(MEDIA_UPLOAD_CONCURRENCY, files.length) },
      () => worker(),
    ),
  );

  return {
    ids: savedMedia.flatMap((media) => (media ? [media.id] : [])),
    errors: errors.filter(
      (error): error is { name: string; message: string } => Boolean(error),
    ),
  };
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
export async function deleteMedia(id: string, url: string, userId: string) {
  const prefix = `storage://${userId}/`;
  if (!url.startsWith(prefix) || url.includes(".."))
    throw new Error("Não foi possível validar o arquivo desta mídia.");

  const [activeFlows, pendingJobs, pendingDrafts] = await Promise.all([
    db
      .from("ig_flows")
      .select("settings")
      .eq("user_id", userId)
      .in("state", ["active", "paused"]),
    db
      .from("ig_publication_jobs")
      .select("id")
      .eq("user_id", userId)
      .contains("media_urls", [url])
      .in("status", ["scheduled", "processing", "failed", "uncertain"])
      .limit(1),
    db
      .from("instagram_publication_drafts")
      .select("id")
      .eq("user_id", userId)
      .contains("media_urls", [url])
      .neq("status", "cancelled")
      .limit(1),
  ]);

  if (activeFlows.error || pendingJobs.error || pendingDrafts.error)
    throw new Error("Não foi possível verificar se esta mídia está em uso.");
  if (
    activeFlows.data?.some(
      (flow) =>
        flow.settings?.mediaIds?.includes(id) || flow.settings?.coverId === id,
    ) ||
    pendingJobs.data?.length ||
    pendingDrafts.data?.length
  )
    throw new Error(
      "Conclua ou cancele os fluxos, postagens e rascunhos que usam esta mídia antes de excluí-la.",
    );

  const path = url.slice("storage://".length);
  const { error: storageError } = await storage
    .from("instagram-publisher")
    .remove([path]);
  if (storageError)
    throw new Error("Não foi possível excluir o arquivo da mídia.");

  const { data, error } = await db
    .from("ig_flow_library")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error || !data)
    throw new Error(
      "O arquivo foi excluído, mas não foi possível remover o registro da biblioteca.",
    );
}
export async function savePrefs(prefs: Prefs) {
  const deletedIds = [...getDeletedFlowIdsSet(prefs.user_id, prefs)];
  const mergedPrefs: Prefs =
    deletedIds.length > 0 || prefs.folder_captions
      ? {
          ...prefs,
          folder_captions: {
            ...(prefs.folder_captions ?? {}),
            ...(deletedIds.length > 0
              ? { [DELETED_FLOWS_FIELD]: deletedIds }
              : {}),
          },
        }
      : prefs;
  const { error } = await db.from("ig_flow_preferences").upsert(mergedPrefs);
  if (error) throw new Error("Não foi possível salvar suas preferências.");
}
export const createFlow = (input: FlowInput) =>
  publisherRequest("create_flow", { flow: input });
export const controlFlow = (id: string, control: "pause" | "resume" | "stop") =>
  publisherRequest("control_flow", { id, control });
export const cancelFlow = (id: string) =>
  publisherRequest("cancel_flow", { id });

export async function deleteFlow(id: string, userId?: string) {
  await cancelFlow(id).catch(() => null);
  await publisherRequest("delete_flow", { id }).catch(() => null);
  await db
    .from("ig_flows")
    .delete()
    .eq("id", id)
    .then(
      () => null,
      () => null,
    );

  let resolvedUserId = userId;
  if (!resolvedUserId) {
    const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    resolvedUserId = data.user?.id;
  }

  if (resolvedUserId) {
    const existingLocal = readLocalDeletedFlowIds(resolvedUserId);
    const updatedLocal = [...new Set([...existingLocal, id])];
    writeLocalDeletedFlowIds(resolvedUserId, updatedLocal);

    const { data: currentPrefs } = await db
      .from("ig_flow_preferences")
      .select("*")
      .eq("user_id", resolvedUserId)
      .maybeSingle();

    const basePrefs = (currentPrefs as unknown as Prefs | null) ?? {
      user_id: resolvedUserId,
      folders: [],
      captions: [],
    };
    const allDeleted = [...getDeletedFlowIdsSet(resolvedUserId, basePrefs), id];
    const uniqueDeleted = [...new Set(allDeleted)];
    writeLocalDeletedFlowIds(resolvedUserId, uniqueDeleted);

    await db
      .from("ig_flow_preferences")
      .upsert({
        ...basePrefs,
        folder_captions: {
          ...(basePrefs.folder_captions ?? {}),
          [DELETED_FLOWS_FIELD]: uniqueDeleted,
        },
      })
      .then(
        () => null,
        () => null,
      );
  }
}

export async function previewMedia(url: string) {
  const { data, error } = await storage
    .from("instagram-publisher")
    .createSignedUrl(url.slice(10), 600);
  if (error) throw new Error("Não foi possível abrir esta mídia.");
  return data.signedUrl;
}
