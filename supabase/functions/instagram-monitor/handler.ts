export type MonitorRepository = {
  authenticate: (jwt: string) => Promise<string | null>;
  workerKey: () => Promise<string | null>;
  worker: () => Promise<{ checked: number; failures: number }>;
  status: (userId: string) => Promise<unknown>;
  read: (userId: string, id?: string) => Promise<number>;
  refresh: (
    userId: string,
    accountId: string,
  ) => Promise<"checked" | "recent" | "busy" | "not_found">;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function monitorHandler(
  repo: MonitorRepository,
  origins = new Set<string>(),
) {
  return async (req: Request) => {
    const origin = req.headers.get("origin") || "";
    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origins.has(origin)
        ? origin
        : "https://organizafyd.vercel.app",
      "Access-Control-Allow-Headers":
        "authorization,apikey,content-type,x-client-info",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      Vary: "Origin",
    };
    const reply = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers });
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (req.method !== "POST") {
      return reply({ error: "method_not_allowed" }, 405);
    }
    try {
      const raw = await req.text();
      if (raw.length > 2000) return reply({ error: "request_too_large" }, 413);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return reply({ error: "invalid_request" }, 400);
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return reply({ error: "invalid_request" }, 400);
      }
      if (body.action === "worker") {
        const key = await repo.workerKey();
        if (!key || req.headers.get("x-worker-secret") !== key) {
          return reply({ error: "unauthorized" }, 401);
        }
        const result = await repo.worker();
        return reply(result, result.failures ? 503 : 200);
      }
      const jwt = req.headers.get("authorization")?.replace(/^Bearer /i, "");
      if (!jwt) return reply({ error: "unauthorized" }, 401);
      const userId = await repo.authenticate(jwt);
      if (!userId) return reply({ error: "unauthorized" }, 401);
      if (body.action === "status") return reply(await repo.status(userId));
      if (body.action === "read_all") {
        return reply({ ok: true, updated: await repo.read(userId) });
      }
      if (
        body.action === "read" && typeof body.id === "string" &&
        uuid.test(body.id)
      ) {
        return reply({ ok: true, updated: await repo.read(userId, body.id) });
      }
      if (
        body.action === "refresh" && typeof body.id === "string" &&
        uuid.test(body.id)
      ) {
        const status = await repo.refresh(userId, body.id);
        return reply({ status }, status === "not_found" ? 404 : 200);
      }
      return reply({ error: "invalid_action" }, 400);
    } catch {
      return reply({ error: "monitor_unavailable" }, 500);
    }
  };
}
