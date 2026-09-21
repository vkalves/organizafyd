import { describe, expect, it } from "vitest";
import {
  safeUrl,
  localDay,
  localInput,
  matchesSearch,
  contentCounts,
  type Account,
  type Content,
} from "./model";
describe("Instagram data boundaries", () => {
  it("rejects executable and malformed media/profile URLs", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "not-a-url",
    ])
      expect(safeUrl(url)).toBeUndefined();
    expect(safeUrl("https://instagram.com/test")).toBe(
      "https://instagram.com/test",
    );
  });
  it("uses local calendar dates and round-trips datetime inputs", () => {
    const d = new Date(2026, 8, 20, 23, 45);
    expect(localDay(d)).toBe("2026-09-20");
    expect(localInput(d.toISOString())).toBe("2026-09-20T23:45");
  });
  it("searches account, notes and device without accent sensitivity", () => {
    const account = {
      username: "bianca.main",
      name: "Bianca",
      notes: "Revisar descrição",
      responsible: "Iphone 8 plus",
    } as Account;
    for (const search of ["BIANCA", "descricao", "main", "@bianca", "iphone"])
      expect(matchesSearch(account, search)).toBe(true);
    expect(matchesSearch(account, "outra")).toBe(false);
    expect(matchesSearch(account, "XR branco")).toBe(false);
  });
  it("splits contents into published, ready and pending buckets", () => {
    const items = [
      { status: "published" },
      { status: "ready" },
      { status: "ready" },
      { status: "idea" },
      { status: "producing" },
    ] as Content[];
    expect(contentCounts(items)).toEqual({
      published: 1,
      ready: 2,
      pending: 2,
    });
  });
});
