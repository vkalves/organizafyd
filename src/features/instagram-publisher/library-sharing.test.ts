// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, it, expect, vi } from "vitest";
import { normalizeHandle, librarySharing } from "../../../supabase/functions/instagram-publisher/library-sharing";

function client(results: unknown[]) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(), upsert: vi.fn().mockReturnThis(), delete: vi.fn().mockReturnThis(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: results.shift(), error: null }).then(resolve) };
  const from = vi.fn(() => query);
  return { db: { from } as unknown as Parameters<typeof librarySharing>[0], from, query };
}
describe("library sharing", () => {
  it("canonicalizes @ and rejects invalid handles", () => {
    expect(normalizeHandle(" @Maria_123 ")).toBe("maria_123");
    for (const value of [null, "ab", "a b", "@@maria", "a".repeat(31), "ábc"]) expect(() => normalizeHandle(value)).toThrow("invalid_handle");
  });
  it("does not read media or sign downloads without a grant", async () => {
    const { db, from, query } = client([null]); const sign = vi.fn();
    await expect(librarySharing(db, "recipient", { action: "library_download", owner_id: "owner", media_id: "media" }, sign)).rejects.toThrow("library_access_denied");
    expect(from).toHaveBeenCalledTimes(1);
    expect(query.eq).toHaveBeenCalledWith("recipient_id", "recipient");
    expect(sign).not.toHaveBeenCalled();
  });
  it("signs only active media belonging to the authorized owner", async () => {
    const { db, query } = client([{ owner_id: "owner" }, { url: "storage://owner/image.jpg", kind: "posts", caption: "caption", folder: "folder" }]);
    const sign = vi.fn().mockResolvedValue("https://signed.test/image");
    expect(await librarySharing(db, "recipient", { action: "library_download", owner_id: "owner", media_id: "media" }, sign)).toMatchObject({ url: "https://signed.test/image", caption: "caption" });
    expect(query.eq).toHaveBeenCalledWith("user_id", "owner"); expect(query.eq).toHaveBeenCalledWith("retired", false);
    expect(sign).toHaveBeenCalledWith("storage://owner/image.jpg");
  });
  it("limits revocation to the authenticated owner's grant", async () => {
    const { db, query } = client([null]);
    await librarySharing(db, "owner", { action: "library_revoke", recipient_id: "recipient", owner_id: "victim" }, vi.fn());
    expect(query.eq).toHaveBeenCalledWith("owner_id", "owner");
  });
  it("enforces unique handles, foreign keys, isolation and cleanup in Postgres", async () => {
    const db = new PGlite();
    try {
      await db.exec("create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);");
      await db.exec(readFileSync(new URL("../../../supabase/migrations/20261113110302_user_library_sharing.sql", import.meta.url), "utf8"));
      const a = "00000000-0000-4000-8000-000000000001", b = "00000000-0000-4000-8000-000000000002";
      await db.query("insert into auth.users values ($1),($2)", [a, b]);
      await db.query("insert into ig_library_handles values ($1,'maria'),($2,'joao')", [a, b]);
      await expect(db.query("update ig_library_handles set handle='maria' where user_id=$1", [b])).rejects.toThrow();
      await expect(db.query("insert into ig_library_shares(owner_id,recipient_id) values ($1,$1)", [a])).rejects.toThrow();
      await db.query("insert into ig_library_shares(owner_id,recipient_id) values ($1,$2)", [a, b]);
      await db.exec("set role authenticated");
      await expect(db.query("select * from ig_library_handles")).rejects.toThrow("permission denied");
      await expect(db.query("select * from ig_library_shares")).rejects.toThrow("permission denied");
      await db.exec("reset role");
      await db.query("delete from auth.users where id=$1", [a]);
      expect((await db.query("select * from ig_library_shares")).rows).toEqual([]);
    } finally { await db.close(); }
  });
});
