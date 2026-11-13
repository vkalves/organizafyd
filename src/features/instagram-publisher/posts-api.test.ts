// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "./model";
const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  pages: [] as { table: string; from: number; to: number; user: string }[],
  failFrom: -1,
}));
vi.mock("@/lib/storage", () => ({ storage: {} }));
vi.mock("@/features/x/clean-media", () => ({ cleanMedia: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  let user = "";
  const query = {
    select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    eq: (column: string, value: string) => { if (column === "user_id") user = value; return query; },
    range: async (from: number, to: number) => {
      mocks.pages.push({ table, from, to, user });
      if (table === "ig_publication_jobs" && from === mocks.failFrom) return { data: null, error: new Error("offline") };
      return { data: (mocks.tables[table] ?? []).slice(from, to + 1), error: null };
    },
  };
  return query;
} } }));
import { listPosts } from "./api";
const job = (id: string, account = "existing"): Post => ({
  id, user_id: "owner", account_id: account, caption: "", format: "Reel", media_urls: [],
  scheduled_at: "2026-11-14T12:00:00Z", status: "scheduled", created_at: "2026-11-13T12:00:00Z", updated_at: "2026-11-13T12:00:00Z",
});
beforeEach(() => { mocks.tables = {}; mocks.pages = []; mocks.failFrom = -1; });
describe("complete publication queue", () => {
  it("keeps schedules from every account beyond the former 200-row limit and database page size", async () => {
    mocks.tables.ig_publication_jobs = [...Array.from({ length: 1000 }, (_, i) => job(`existing-${i}`)), job("late-account-job", "new-account")];
    const result = await listPosts("owner");
    expect(result).toHaveLength(1001);
    expect(result.filter(p => p.account_id === "new-account" && p.status === "scheduled")).toHaveLength(1);
    expect(mocks.pages.filter(p => p.table === "ig_publication_jobs").map(p => p.from)).toEqual([0, 500, 1000]);
    expect(mocks.pages.every(p => p.user === "owner")).toBe(true);
  });
  it("paginates drafts and replaces an already scheduled draft with its job", async () => {
    mocks.tables.instagram_publication_drafts = Array.from({ length: 501 }, (_, i) => ({ ...job(`draft-${i}`), status: "draft" }));
    mocks.tables.ig_publication_jobs = [job("draft-500")];
    const result = await listPosts("owner");
    expect(result).toHaveLength(501);
    expect(result.find(p => p.id === "draft-500")?.source).toBe("job");
  });
  it("reports a failed later page instead of displaying a partial queue as complete", async () => {
    mocks.tables.ig_publication_jobs = Array.from({ length: 501 }, (_, i) => job(String(i)));
    mocks.failFrom = 500;
    await expect(listPosts("owner")).rejects.toThrow("Não foi possível carregar a fila");
  });
});
