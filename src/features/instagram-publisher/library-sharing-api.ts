import { storage } from "@/lib/storage";
import { supabase } from "@/integrations/supabase/client";
import { publisherRequest } from "./api";
import type { Media } from "./flows-api";

export async function importSharedMedia(ownerId: string, mediaId: string, userId: string) {
  const media = await publisherRequest<Pick<Media, "url" | "kind" | "caption" | "folder">>("library_download", { owner_id: ownerId, media_id: mediaId });
  const response = await fetch(media.url);
  if (!response.ok) throw new Error("Não foi possível baixar esta mídia.");
  const blob = await response.blob();
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov" } as Record<string, string>)[blob.type];
  if (!extension) throw new Error("Formato de mídia não suportado.");
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;
  const bucket = storage.from("instagram-publisher");
  const uploaded = await bucket.upload(path, blob, { contentType: blob.type });
  if (uploaded.error) throw new Error(uploaded.error.message);
  const { error } = await supabase.from("ig_flow_library" as never).insert({
    user_id: userId, url: `storage://${path}`, kind: media.kind, folder: media.folder, caption: media.caption,
  } as never);
  if (error) {
    await bucket.remove([path]);
    throw new Error("Não foi possível registrar a cópia na sua biblioteca.");
  }
}
