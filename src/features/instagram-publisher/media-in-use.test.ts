// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ results: [] as { data: { id: string }[] | null; error: unknown }[], filters: [] as { table: string; column: string; value: unknown }[], remove: vi.fn() }));
vi.mock("./api", () => ({ publisherRequest: vi.fn(), uploadMedia: vi.fn() }));
vi.mock("@/lib/storage", () => ({ storage: { from: () => ({ remove: mocks.remove }) } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  const result = mocks.results.shift() ?? { data: [], error: null };
  const query = {
    select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), neq: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(),
    eq: (column: string, value: unknown) => { mocks.filters.push({ table, column, value }); return query; },
    contains: (column: string, value: unknown) => { mocks.filters.push({ table, column, value }); return query; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return query;
} } }));
import { mediaInUse, deleteMedia, loadLibraryMedia } from "./flows-api";
beforeEach(() => { vi.clearAllMocks(); mocks.filters.length = 0; mocks.results = Array.from({ length: 5 }, () => ({ data: [], error: null })); });
describe("media reference protection", () => {
  it("loads every library page before duplicate analysis", async () => {
    mocks.results = [{ data: Array.from({ length: 500 }, (_, index) => ({ id: String(index) })), error: null }, { data: [{ id: "last" }], error: null }];
    const media = await loadLibraryMedia("user");
    expect(media).toHaveLength(501); expect(media.at(-1)?.id).toBe("last");
  });
  it.each([0, 1, 2, 3, 4])("blocks deletion when reference query %i finds a flow, cover, job or draft", async (index) => {
    mocks.results[index].data = [{ id: "reference" }];
    await expect(deleteMedia("media", "storage://user/image.jpg", "user")).rejects.toThrow("antes de excluí-la");
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("queries specific references on the server and scopes all checks to the owner", async () => {
    expect(await mediaInUse("media", "storage://user/image.jpg", "user")).toBe(false);
    expect(mocks.filters.filter((f) => f.column === "user_id")).toHaveLength(5);
    expect(mocks.filters).toContainEqual({ table: "ig_flows", column: "settings", value: { mediaIds: ["media"] } });
    expect(mocks.filters).toContainEqual({ table: "ig_flows", column: "settings->>coverId", value: "media" });
    expect(mocks.filters).toContainEqual({ table: "ig_publication_jobs", column: "cover_url", value: "storage://user/image.jpg" });
  });
  it("fails closed if reference checks fail", async () => {
    mocks.results[3] = { data: null, error: new Error("database unavailable") };
    await expect(deleteMedia("media", "storage://user/image.jpg", "user")).rejects.toThrow("Não foi possível verificar");
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
