import { storage } from "@/lib/storage";
import { loadLibraryMedia, mediaInUse, type Media } from "./flows-api";

export type DuplicateScan = {
  total: number;
  groups: number;
  protected: number;
  duplicates: Media[];
  failures: { id: string; message: string }[];
};

export async function scanDuplicateMedia(userId: string, options: {
  signal: AbortSignal;
  onProgress: (completed: number, total: number) => void;
}): Promise<DuplicateScan> {
  const checkCancelled = () => options.signal.throwIfAborted();
  const media = await loadLibraryMedia(userId);
  checkCancelled();
  const groups = new Map<string, Media[]>();
  const failures: DuplicateScan["failures"] = [];
  options.onProgress(0, media.length);
  for (const [index, item] of media.entries()) {
    checkCancelled();
    try {
      if (item.user_id !== userId || !item.url.startsWith(`storage://${userId}/`) || item.url.includes(".."))
        throw new Error("Não foi possível validar o arquivo desta mídia.");
      const { data, error } = await storage.from("instagram-publisher").download(item.url.slice(10));
      if (error || !data) throw new Error("Não foi possível ler este arquivo. Ele será preservado.");
      // Hash actual bytes, never names, URLs, captions or image similarity.
      // Download sequentially to keep only one file in memory at a time.
      const digest = await crypto.subtle.digest("SHA-256", await data.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const group = groups.get(hash) ?? [];
      group.push(item);
      groups.set(hash, group);
    } catch (error) {
      failures.push({ id: item.id, message: error instanceof Error ? error.message : "Não foi possível analisar este arquivo." });
    }
    checkCancelled();
    options.onProgress(index + 1, media.length);
  }
  const result: DuplicateScan = { total: media.length, groups: 0, protected: 0, duplicates: [], failures };
  for (const group of groups.values()) {
    checkCancelled();
    if (group.length < 2) continue;
    result.groups++;
    try {
      const used = new Set<string>();
      for (const item of group) {
        checkCancelled();
        if (await mediaInUse(item.id, item.url, userId)) used.add(item.id);
      }
      // Prefer an in-use copy as keeper. If several are referenced, keep all
      // of them; deleting those would break existing flows or queued work.
      const keeper = group.find((item) => used.has(item.id)) ?? group[0];
      result.protected += Math.max(0, used.size - 1);
      result.duplicates.push(...group.filter((item) => item.id !== keeper.id && !used.has(item.id)));
    } catch (error) {
      checkCancelled();
      // If usage cannot be established, preserve the entire group.
      failures.push({ id: group[0].id, message: error instanceof Error ? error.message : "Não foi possível verificar o uso destas mídias." });
    }
  }
  return result;
}
