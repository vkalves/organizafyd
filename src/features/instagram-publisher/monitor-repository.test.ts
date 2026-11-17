import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createMonitorRepository } from "../../../supabase/functions/instagram-monitor/repository";
beforeAll(() => {
  if (!("timeout" in AbortSignal)) {
    Object.defineProperty(AbortSignal, "timeout", {
      value: () => new AbortController().signal,
    });
  }
});
const owner = "11111111-1111-4111-8111-111111111111";
const account = "22222222-2222-4222-8222-222222222222";
function setup(
  options: {
    health?: Record<string, unknown>;
    loseClaim?: boolean;
    missingConnection?: boolean;
  } = {},
) {
  const requests: { url: URL; init: RequestInit }[] = [];
  const graph = vi.fn(async () => new Response(JSON.stringify({ id: "123" })));
  const transport = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      requests.push({ url, init });
      const json = (data: unknown, headers = {}) =>
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { "content-type": "application/json", ...headers },
        });
      if (url.pathname.endsWith("/ig_publisher_connections")) {
        return json(
          options.missingConnection
            ? []
            : [{ graph_id: "123", secret_id: "secret", provider: "instagram" }],
        );
      }
      if (url.pathname.endsWith("/ig_vault_read")) return json("private-token");
      if (url.pathname.endsWith("/ig_account_health")) {
        if (init.method === "POST") return json(null);
        if (init.method === "PATCH") {
          const update = JSON.parse(String(init.body));
          if (update.lease) {
            return json(
              options.loseClaim ? null : {
                ...options.health,
                lease: update.lease,
                next_check_at: update.next_check_at,
              },
            );
          }
          return json(null);
        }
        if (url.searchParams.has("account_id")) {
          return json(options.health ? [options.health] : []);
        }
        return json([{ account_id: account, state: "healthy" }]);
      }
      if (url.pathname.endsWith("/ig_account_alerts")) {
        if (init.method === "PATCH") {
          return json(null, { "content-range": "0-1/2" });
        }
        if (url.searchParams.get("resolved_at") === "is.null") {
          const offset = Number(url.searchParams.get("offset") || 0);
          return json(
            Array.from(
              { length: Math.max(0, Math.min(500, 501 - offset)) },
              (_, i) => ({ id: `active-${offset + i}`, resolved_at: null }),
            ),
          );
        }
        return json([{ id: "history", resolved_at: "today" }]);
      }
      throw new Error("Unexpected request: " + url.pathname);
    },
  );
  const db = createClient("https://test-project.supabase.co", "test-key", {
    global: { fetch: transport as typeof fetch },
    auth: { persistSession: false, storageKey: crypto.randomUUID() },
  });
  return {
    requests,
    graph,
    repo: createMonitorRepository(db, graph as typeof fetch),
  };
}
const completed = () => ({
  account_id: account,
  user_id: owner,
  state: "healthy",
  candidate: "healthy",
  failures: 0,
  lease: "old-lease",
  checked_at: new Date(Date.now() - 120000).toISOString(),
  next_check_at: new Date(Date.now() + 120000).toISOString(),
});
describe("Monitor repository ownership, pagination and manual check leases", () => {
  it("keeps every active problem even when resolved history is limited", async () => {
    const { repo, requests } = setup();
    const result = await repo.status(owner) as { alerts: { id: string }[] };
    expect(result.alerts).toHaveLength(502);
    expect(result.alerts[500].id).toBe("active-500");
    const reads = requests.filter((r) => r.init.method === "GET");
    expect(
      reads.every((r) => r.url.searchParams.get("user_id") === `eq.${owner}`),
    ).toBe(true);
    expect(
      reads.some((r) =>
        r.url.searchParams.get("resolved_at") === "not.is.null" &&
        r.url.searchParams.get("limit") === "100"
      ),
    ).toBe(true);
  });
  it("marks only the owners unread, active alerts and returns the exact affected count", async () => {
    const { repo, requests } = setup();
    expect(await repo.read(owner)).toBe(2);
    const { url } = requests[0];
    expect(url.searchParams.get("user_id")).toBe(`eq.${owner}`);
    expect(url.searchParams.get("read_at")).toBe("is.null");
    expect(url.searchParams.get("resolved_at")).toBe("is.null");
  });
  it("checks ownership before accessing a token or creating a health row", async () => {
    const { repo, requests, graph } = setup({ missingConnection: true });
    expect(await repo.refresh(owner, account)).toBe("not_found");
    expect(requests).toHaveLength(1);
    expect(graph).not.toHaveBeenCalled();
    expect(requests[0].url.searchParams.get("user_id")).toBe(`eq.${owner}`);
  });
  it("enforces a one-minute cooldown and avoids a running worker claim", async () => {
    const recent = setup({
      health: { ...completed(), checked_at: new Date().toISOString() },
    });
    expect(await recent.repo.refresh(owner, account)).toBe("recent");
    expect(recent.graph).not.toHaveBeenCalled();
    const running = setup({
      health: {
        ...completed(),
        checked_at: new Date(Date.now() - 600000).toISOString(),
      },
    });
    expect(await running.repo.refresh(owner, account)).toBe("busy");
    expect(running.graph).not.toHaveBeenCalled();
  });
  it("does not run Meta checks after losing a concurrent lease claim", async () => {
    const { repo, graph } = setup({ health: completed(), loseClaim: true });
    expect(await repo.refresh(owner, account)).toBe("busy");
    expect(graph).not.toHaveBeenCalled();
  });
  it("claims a finished account with compare-and-swap and saves only under the new lease", async () => {
    const { repo, requests, graph } = setup({ health: completed() });
    expect(await repo.refresh(owner, account)).toBe("checked");
    expect(graph).toHaveBeenCalledOnce();
    const updates = requests.filter((r) => r.init.method === "PATCH");
    expect(updates).toHaveLength(2);
    expect(updates[0].url.searchParams.get("lease")).toBe("eq.old-lease");
    const newLease = JSON.parse(String(updates[0].init.body)).lease;
    expect(updates[1].url.searchParams.get("lease")).toBe(`eq.${newLease}`);
    expect(
      updates.every((r) => r.url.searchParams.get("user_id") === `eq.${owner}`),
    ).toBe(true);
  });
});
