import { uploadAllowed, type Bucket } from "./policy.ts";

export type CopyDependencies = {
  inspect: () => Promise<{ size: number; type: string; etag: string } | null>;
  inventory: () => Promise<void>;
  reserve: (size: number) => Promise<string | null>;
  copy: (source: { type: string; etag: string }) => Promise<void>;
  legacyCopy: () => Promise<void>;
  cleanup: () => Promise<void>;
};

/** S3 copies bytes inside AWS. Never buffers or downloads a video in the
 * browser/Edge Function. Legacy Supabase files use its native copy API. */
export async function copyStoredObject(bucket: Bucket, deps: CopyDependencies) {
  const source = await deps.inspect();
  if (!source) { await deps.legacyCopy(); return; }
  if (!uploadAllowed(bucket, source.type, source.size) || !source.etag) throw new Error("invalid_upload");
  await deps.inventory();
  const quotaError = await deps.reserve(source.size);
  if (quotaError) throw new Error(quotaError);
  try {
    // If the source changes after HEAD, the conditional copy fails instead of
    // storing bytes beyond the quota reservation.
    await deps.copy(source);
  } catch (error) {
    // Copy may succeed even if its response is lost. Remove only our new path;
    // keep its reservation if removal could not be confirmed.
    await deps.cleanup().catch(() => {});
    throw error;
  }
}

/** Share in-flight/recent inventories within an isolate; every individual
 * copy still makes an atomic quota reservation in Postgres. */
export function recentInventories(ttlMs = 30_000, now = Date.now) {
  const entries = new Map<string, { expires: number; pending: Promise<void> }>();
  return async (user: string, sync: () => Promise<void>) => {
    const existing = entries.get(user);
    if (existing && existing.expires > now()) return await existing.pending;
    for (const [key, value] of entries) if (value.expires <= now()) entries.delete(key);
    const entry = { expires: Infinity, pending: Promise.resolve().then(sync) };
    entries.set(user, entry);
    try { await entry.pending; entry.expires = now() + ttlMs; }
    catch (error) { if (entries.get(user) === entry) entries.delete(user); throw error; }
  };
}
