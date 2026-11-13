import { describe, expect, it } from "vitest";
import { readSharedFlowProgress } from "../../../supabase/functions/instagram-publisher/shared-flow-progress";

function database({ revoked = false, failure = false, jobs = 1 } = {}) {
  const rows = Array.from({ length: jobs }, (_, i) => ({ id: String(i), flow_id: "flow", account_id: "account", shared_account_owner: "guest", status: i ? "published" : "scheduled", format: "Reel", scheduled_at: "2026-11-14T10:00:00Z", published_at: null, media_urls: ["private"], secret: "private" }));
  rows.push({ ...rows[0], id: "foreign", shared_account_owner: "other" });
  rows.push({ ...rows[0], id: "foreign-account", account_id: "other" });
  const calls: string[] = [];
  const db = {
    rpc: async (_name: string, args: { p_user: string }) => ({ data: args.p_user === "guest" ? [{ flow_id: "flow", flow_name: "Original", account_id: "account", username: "myprofile" }] : [], error: null }),
    from(table: string) {
      calls.push(table);
      let fields: string[] = [], start = 0, end = Infinity;
      const filters: [string, unknown][] = [];
      const q = {
        select(value: string) { fields = value.split(","); return q; },
        eq(key: string, value: unknown) { filters.push([key, value]); return q; },
        order() { return q; },
        range(a: number, b: number) { start = a; end = b; return q; },
        maybeSingle: async () => ({ data: table === "ig_flows" ? { state: "active" } : revoked ? null : { account_id: "account" }, error: null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: rows.filter(row => filters.every(([key, value]) => row[key as keyof typeof row] === value)).slice(start, end + 1).map(row => Object.fromEntries(fields.map(field => [field, row[field as keyof typeof row]]))), error: failure ? new Error("offline") : null }).then(resolve);
        },
      };
      return q;
    },
  };
  return { db: db as unknown as Parameters<typeof readSharedFlowProgress>[0], calls };
}

describe("shared flow participant monitoring", () => {
  it("reports only the participant's authorized account and excludes private media and credentials", async () => {
    const { db } = database();
    const report = await readSharedFlowProgress(db, "guest");
    expect(report).toHaveLength(1);
    expect(report[0].flow_id).toBe("flow");
    expect(report[0].counts).toEqual({ scheduled: 1 });
    expect(report[0].next_at).toBe("2026-11-14T10:00:00Z");
    expect(JSON.stringify(report)).not.toContain("private");
    expect(report[0].recent.map(job => job.id)).toEqual(["0"]);
  });
  it("counts all pages while keeping a bounded recent list", async () => {
    const { db } = database({ jobs: 1101 });
    const [report] = await readSharedFlowProgress(db, "guest");
    expect(report.counts).toEqual({ scheduled: 1, published: 1100 });
    expect(report.recent).toHaveLength(20);
  });
  it("does not expose the flow after access is revoked or to a stranger", async () => {
    const { db } = database({ revoked: true });
    expect(await readSharedFlowProgress(db, "guest")).toEqual([]);
    const stranger = database();
    expect(await readSharedFlowProgress(stranger.db, "stranger")).toEqual([]);
    expect(stranger.calls).toEqual([]);
  });
  it("fails visibly rather than presenting database errors as zero publications", async () => {
    const { db } = database({ failure: true });
    await expect(readSharedFlowProgress(db, "guest")).rejects.toThrow("database_error");
  });
});
