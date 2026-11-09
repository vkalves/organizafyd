export type AccountConnection = {
  account_id: string;
  graph_id: string;
  secret_id: string;
  provider: string;
};
export type AccountPhoto = { account_id: string; avatar_url: string | null };
export interface AccountRepository {
  authenticate(jwt: string): Promise<string | null>;
  connections(userId: string, ids: string[]): Promise<AccountConnection[]>;
  photos(userId: string, ids: string[]): Promise<AccountPhoto[]>;
  token(secretId: string): Promise<string>;
  savePhoto(userId: string, accountId: string, url: string): Promise<void>;
  disconnect(userId: string, accountId: string): Promise<void>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const origins = new Set(["https://www.organizafy.site", "https://organizafy.site"]);
export function safePhotoUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function accountHandler(repository: AccountRepository, request: typeof fetch = fetch) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin") || "";
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origins.has(origin) ? origin : "https://www.organizafy.site",
      "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      Vary: "Origin",
    };
    const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
    try {
      const jwt = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!jwt) return reply({ error: "unauthorized" }, 401);
      const userId = await repository.authenticate(jwt);
      if (!userId) return reply({ error: "unauthorized" }, 401);
      const raw = await req.text();
      if (raw.length > 10000) return reply({ error: "invalid_request" }, 400);
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); } catch { return reply({ error: "invalid_request" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "invalid_request" }, 400);
      if (body.action === "disconnect") {
        if (typeof body.account_id !== "string" || !UUID.test(body.account_id)) return reply({ error: "invalid_request" }, 400);
        await repository.disconnect(userId, body.account_id);
        return reply({ ok: true });
      }
      if (body.action !== "profiles" || !Array.isArray(body.account_ids) || body.account_ids.length < 1 || body.account_ids.length > 10 || body.account_ids.some((id) => typeof id !== "string" || !UUID.test(id))) {
        return reply({ error: "invalid_request" }, 400);
      }
      const ids = [...new Set(body.account_ids as string[])];
      const owned = await repository.connections(userId, ids);
      if (owned.length !== ids.length) return reply({ error: "account_not_found" }, 404);
      const cached = new Map((await repository.photos(userId, ids)).map((row) => [row.account_id, safePhotoUrl(row.avatar_url)]));
      const photos: AccountPhoto[] = [];
      for (let offset = 0; offset < owned.length; offset += 4) {
        photos.push(...await Promise.all(owned.slice(offset, offset + 4).map(async (connection) => {
          const previous = cached.get(connection.account_id) || null;
          if (previous && body.refresh !== true) return { account_id: connection.account_id, avatar_url: previous };
          try {
            if (!/^\d+$/.test(connection.graph_id)) throw new Error("invalid_graph_id");
            const token = await repository.token(connection.secret_id);
            const host = connection.provider === "instagram" ? "graph.instagram.com" : "graph.facebook.com";
            const url = new URL(`https://${host}/v24.0/${connection.graph_id}`);
            url.searchParams.set("fields", "id,profile_picture_url");
            const response = await request(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
            if (!response.ok) throw new Error("profile_unavailable");
            const profile = await response.json();
            if (profile.error || String(profile.id) !== connection.graph_id) throw new Error("profile_unavailable");
            const avatar = safePhotoUrl(profile.profile_picture_url);
            if (!avatar) throw new Error("profile_unavailable");
            await repository.savePhoto(userId, connection.account_id, avatar);
            return { account_id: connection.account_id, avatar_url: avatar };
          } catch {
            // An expired token or unavailable photo does not prove that a profile was deleted.
            return { account_id: connection.account_id, avatar_url: previous };
          }
        })));
      }
      return reply({ photos });
    } catch (error) {
      const code = error instanceof Error ? error.message : "request_failed";
      if (code === "account_busy") return reply({ error: code }, 409);
      if (code === "account_not_found") return reply({ error: code }, 404);
      return reply({ error: "request_failed" }, 500);
    }
  };
}
