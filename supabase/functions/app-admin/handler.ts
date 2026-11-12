interface AdminDatabase {
  auth: { getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(name: string, params: Record<string, unknown>): PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
}
const origins = new Set(["https://www.organizafy.site", "https://organizafy.site", "https://xn--avana-1ra.online", "https://www.xn--avana-1ra.online", "https://organizafyd.vercel.app"]);
export function createAdminHandler(db: AdminDatabase) { return async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": origins.has(origin) ? origin : "https://www.organizafy.site", "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info", "Access-Control-Allow-Methods": "POST,OPTIONS", Vary: "Origin" };
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return reply({ error: "unauthorized" }, 401);
  try {
    const { data: { user }, error } = await db.auth.getUser(token);
    if (error || !user) return reply({ error: "unauthorized" }, 401);
    const raw = await req.text();
    if (raw.length > 10000) return reply({ error: "invalid_request" }, 400);
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "invalid_request" }, 400);
    const access = await db.rpc("avanca_user_access", { p_user: user.id });
    if (access.error) throw new Error("database_error");
    if (body.action === "access") return reply(access.data);
    if (!access.data?.is_admin) return reply({ error: "forbidden" }, 403);
    if (body.action === "users") {
      const search = body.search ?? "", page = body.page ?? 1;
      if (typeof search !== "string" || search.length > 100 || !Number.isInteger(page) || page < 1 || page > 100000) return reply({ error: "invalid_request" }, 400);
      const result = await db.rpc("avanca_admin_users", { p_actor: user.id, p_search: search, p_page: page });
      if (result.error) throw new Error("database_error");
      return reply(result.data);
    }
    if (body.action === "update_access") {
      if (typeof body.user_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.user_id) || typeof body.connection_allowed !== "boolean" || !(body.max_accounts === null || Number.isInteger(body.max_accounts) && body.max_accounts >= 0 && body.max_accounts <= 10000)) return reply({ error: "invalid_limit" }, 400);
      const result = await db.rpc("avanca_admin_update_access", { p_actor: user.id, p_target: body.user_id, p_allowed: body.connection_allowed, p_max: body.max_accounts });
      if (result.error) {
        if (result.error.message === "user_not_found") return reply({ error: "user_not_found" }, 404);
        throw new Error("database_error");
      }
      return reply({ ok: true });
    }
    return reply({ error: "invalid_request" }, 400);
  } catch (error) { return reply({ error: "request_failed" }, error instanceof SyntaxError ? 400 : 500); }
}; }
