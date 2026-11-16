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
  for (let offset = 0; ; offset += 500) {
    const page = await publisherRequest<{ id: string }[]>("library_browse", { owner_id: ownerId, offset, ids_only: true });
    for (const media of page) ids.add(media.id);
    if (page.length < 500) break;
  }
  const existing = new Set(options.alreadyImported);
  const pending = [...ids].filter((id) => !existing.has(id));
  const failures: { id: string; message: string }[] = [];
  let completed = 0;
  let imported = 0;
  options.onProgress({ completed, total: pending.length });
  // Only IDs cross the browser. Bound server-side copies to three lanes so
  // large libraries move quickly without overwhelming Storage or Postgres.
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
    while (cursor < pending.length) {
      const id = pending[cursor++];
      try {
        await importSharedMedia(ownerId, id, userId);
        imported++;
        options.onImported(id);
      } catch (error) {
        failures.push({ id, message: error instanceof Error ? error.message : "Não foi possível importar esta mídia." });
      }
      options.onProgress({ completed: ++completed, total: pending.length });
    }
  }));
  return { imported, skipped: ids.size - pending.length, failures };
}
