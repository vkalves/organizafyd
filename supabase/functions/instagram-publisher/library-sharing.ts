// Narrow structural contract shared by the Deno handler and Node-based tests.
type Result = { data: unknown; error: { code?: string } | null };
interface Query extends PromiseLike<Result> {
  eq(column: string, value: unknown): Query;
  maybeSingle(): PromiseLike<Result>;
  order(column: string): Query;
  range(from: number, to: number): Query;
}
export interface LibrarySharingDatabase {
  from(table: string): {
    select(columns: string): Query;
    upsert(values: Record<string, unknown>, options?: { onConflict: string }): Query;
    delete(): Query;
    insert(values: Record<string, unknown>): PromiseLike<Result>;
  };
}

export function normalizeHandle(value: unknown): string {
  const handle = typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
  if (!/^[a-z0-9_]{3,30}$/.test(handle)) throw new Error("invalid_handle");
  return handle;
}

type SharedMedia = { url: string; kind: string; folder: string; caption: string };
export type SharedMediaStorage = {
  copy(source: string, path: string): Promise<{ error: { message: string } | null }>;
  remove(paths: string[]): Promise<unknown>;
};
export async function librarySharing(db: LibrarySharingDatabase, userId: string, body: Record<string, unknown>, sign: (url: string) => Promise<string>, storage?: SharedMediaStorage) {
  async function checked<T = unknown>(query: PromiseLike<Result>): Promise<T> {
    const { data, error } = await query;
    if (error) throw new Error(error.code === "23505" ? "handle_unavailable" : "database_error");
    return data as T;
  }
  if (body.action === "library_identity") {
    return checked(db.from("ig_library_handles").select("handle").eq("user_id", userId).maybeSingle());
  }
  if (body.action === "library_set_handle") {
    const handle = normalizeHandle(body.handle);
    await checked(db.from("ig_library_handles").upsert({ user_id: userId, handle }, { onConflict: "user_id" }));
    return { handle };
  }
  if (body.action === "library_shares") {
    const outgoing = await checked(db.from("ig_library_shares").select("recipient_id,recipient:ig_library_handles!recipient_id(handle)").eq("owner_id", userId));
    const incoming = await checked(db.from("ig_library_shares").select("owner_id,owner:ig_library_handles!owner_id(handle)").eq("recipient_id", userId));
    return { outgoing, incoming };
  }
  if (body.action === "library_grant") {
    const target = await checked<{ user_id: string } | null>(db.from("ig_library_handles").select("user_id").eq("handle", normalizeHandle(body.handle)).maybeSingle());
    if (!target || target.user_id === userId) throw new Error("invalid_recipient");
    const identity = await checked(db.from("ig_library_handles").select("user_id").eq("user_id", userId).maybeSingle());
    if (!identity) throw new Error("handle_required");
    await checked(db.from("ig_library_shares").upsert({ owner_id: userId, recipient_id: target.user_id }));
    return { ok: true };
  }
  if (body.action === "library_revoke") {
    if (typeof body.recipient_id !== "string") throw new Error("invalid_recipient");
    await checked(db.from("ig_library_shares").delete().eq("owner_id", userId).eq("recipient_id", body.recipient_id));
    return { ok: true };
  }
  const access = await checked<{ owner_id: string } | null>(db.from("ig_library_shares").select("owner_id").eq("owner_id", body.owner_id).eq("recipient_id", userId).maybeSingle());
  if (!access) throw new Error("library_access_denied");
  if (body.action === "library_browse") {
    const offset = Number(body.offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid_offset");
    const idsOnly = body.ids_only === true;
    return checked(db.from("ig_flow_library").select(idsOnly ? "id" : "id,kind,folder,caption,created_at").eq("user_id", access.owner_id).eq("retired", false).order("created_at").order("id").range(offset, offset + (idsOnly ? 499 : 49)));
  }
  if (body.action === "library_download" || body.action === "library_import") {
    const media = await checked<SharedMedia | null>(db.from("ig_flow_library").select("url,kind,folder,caption").eq("id", body.media_id).eq("user_id", access.owner_id).eq("retired", false).maybeSingle());
    if (!media) throw new Error("media_unavailable");
    if (body.action === "library_import") {
      if (!storage) throw new Error("copy_unavailable");
      if (!media.url.startsWith(`storage://${access.owner_id}/`) || media.url.includes("..")) throw new Error("invalid_media_owner");
      const extension = /\.(jpg|jpeg|mp4)$/i.exec(media.url)?.[1].toLowerCase();
      if (!extension) throw new Error("invalid_media_format");
      const path = `${userId}/${crypto.randomUUID()}.${extension}`;
      const copied = await storage.copy(media.url.slice(10), path);
      if (copied.error) throw new Error(copied.error.message.includes("Limite de armazenamento") || copied.error.message === "storage_quota_exceeded" ? "storage_quota_exceeded" : "copy_failed");
      try {
        await checked(db.from("ig_flow_library").insert({ user_id: userId, url: `storage://${path}`, kind: media.kind, folder: media.folder, caption: media.caption }));
      } catch {
        await storage.remove([path]).catch(() => {});
        throw new Error("library_import_failed");
      }
      return { ok: true };
    }
    return { ...media, url: await sign(media.url) };
  }
  throw new Error("unknown_action");
}
