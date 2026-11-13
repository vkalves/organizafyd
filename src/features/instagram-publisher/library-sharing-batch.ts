import { publisherRequest } from "./api";
import { importSharedMedia } from "./library-sharing-api";

export async function importSharedLibrary(ownerId: string, userId: string, options: {
  alreadyImported: string[];
  onImported: (id: string) => void;
  onProgress: (progress: { completed: number; total: number }) => void;
}) {
  // Collect every page before copying so deleting/retiring source rows during
  // uploads cannot shift pagination and silently skip a page of media.
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 50) {
    const page = await publisherRequest<{ id: string }[]>("library_browse", { owner_id: ownerId, offset });
    for (const media of page) ids.add(media.id);
    if (page.length < 50) break;
  }
  const existing = new Set(options.alreadyImported);
  const pending = [...ids].filter((id) => !existing.has(id));
  const failures: { id: string; message: string }[] = [];
  let completed = 0;
  let imported = 0;
  options.onProgress({ completed, total: pending.length });
  // Keep only one media file in memory at a time, including large videos.
  for (const id of pending) {
    try {
      await importSharedMedia(ownerId, id, userId);
      imported++;
      options.onImported(id);
    } catch (error) {
      failures.push({ id, message: error instanceof Error ? error.message : "Não foi possível importar esta mídia." });
    }
    options.onProgress({ completed: ++completed, total: pending.length });
  }
  return { imported, skipped: ids.size - pending.length, failures };
}
