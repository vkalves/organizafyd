import { describe, expect, it } from "vitest";
import {
  safeUrl,
  localDay,
  localInput,
  matchesSearch,
  type Account,
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
  it("searches account and notes without accent sensitivity", () => {
    const account = {
      username: "bianca.main",
      name: "Bianca",
      notes: "Revisar descrição",
    } as Account;
    for (const search of ["BIANCA", "descricao", "main"])
      expect(matchesSearch(account, search)).toBe(true);
    expect(matchesSearch(account, "outra")).toBe(false);
  });
});
