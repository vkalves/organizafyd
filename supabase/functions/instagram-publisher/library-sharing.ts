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
  };
}

export function normalizeHandle(value: unknown): string {
  const handle = typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
  if (!/^[a-z0-9_]{3,30}$/.test(handle)) throw new Error("invalid_handle");
  return handle;
}

export async function librarySharing(db: LibrarySharingDatabase, userId: string, body: Record<string, unknown>, sign: (url: string) => Promise<string>) {
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
    return checked(db.from("ig_flow_library").select("id,kind,folder,caption,created_at").eq("user_id", access.owner_id).eq("retired", false).order("created_at").order("id").range(offset, offset + 49));
  }
  if (body.action === "library_download") {
    const media = await checked<{ url: string; kind: string; folder: string; caption: string } | null>(db.from("ig_flow_library").select("url,kind,folder,caption").eq("id", body.media_id).eq("user_id", access.owner_id).eq("retired", false).maybeSingle());
    if (!media) throw new Error("media_unavailable");
    return { ...media, url: await sign(media.url) };
  }
  throw new Error("unknown_action");
}
