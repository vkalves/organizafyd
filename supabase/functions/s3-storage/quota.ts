import { buckets } from "./policy.ts";

type InventoryObject = { bucket: string; path: string; size_bytes: number };
type Page = { Contents?: { Key?: string; Size?: number }[]; NextContinuationToken?: string; IsTruncated?: boolean };
export interface QuotaDatabase {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}
export async function syncStorageInventory(
  db: QuotaDatabase,
  user: string,
  list: (prefix: string, continuation?: string) => Promise<Page>,
) {
  const started = new Date().toISOString();
  const objects: InventoryObject[] = [];
  for (const bucket of Object.keys(buckets)) {
    const prefix = `${bucket}/${user}/`;
    let continuation: string | undefined;
    do {
      const page = await list(prefix, continuation);
      for (const item of page.Contents || []) {
        if (!item.Key?.startsWith(prefix) || !Number.isSafeInteger(item.Size) || item.Size! < 0) throw new Error("invalid_inventory");
        objects.push({ bucket, path: item.Key.slice(bucket.length + 1), size_bytes: item.Size! });
      }
      if (page.IsTruncated && !page.NextContinuationToken) throw new Error("incomplete_inventory");
      if (page.NextContinuationToken && page.NextContinuationToken === continuation) throw new Error("incomplete_inventory");
      continuation = page.NextContinuationToken;
    } while (continuation);
  }
  const result = await db.rpc("avanca_storage_sync", { p_user: user, p_objects: objects, p_started: started });
  if (result.error) throw new Error("storage_inventory_failed");
}
export async function reserveStorage(db: QuotaDatabase, user: string, bucket: string, path: string, size: number) {
  const result = await db.rpc("avanca_storage_reserve", { p_user: user, p_bucket: bucket, p_path: path, p_size: size });
  if (result.error) {
    if (["storage_quota_exceeded", "upload_pending"].includes(result.error.message)) return result.error.message;
    throw new Error("storage_reservation_failed");
  }
  // A delayed signing request must never outlive the durable reservation.
  if (typeof result.data !== "string" || !Number.isFinite(Date.parse(result.data)) || Date.parse(result.data) - Date.now() < 180_000) throw new Error("storage_reservation_expired");
  return null;
}
