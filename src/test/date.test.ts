import { describe, expect, it } from "vitest";
import { formatCurrency, formatDate, parseLocalDate, toLocalDateInput } from "@/lib/date";

describe("date helpers", () => {
  it("preserves a local calendar date for date inputs", () => {
    const date = new Date(2026, 0, 2, 12, 30);
    expect(toLocalDateInput(date)).toBe("2026-01-02");
    expect(parseLocalDate("2026-01-02")).toEqual(new Date(2026, 0, 2));
  });

  it("formats invalid and valid dates for Portuguese users", () => {
    expect(formatDate("2026-01-02")).toContain("02");
    expect(formatDate("not-a-date")).toBe("Data inválida");
    expect(formatDate(null)).toBe("Sem data");
  });

  it("formats Brazilian currency", () => {
    expect(formatCurrency(1234.5)).toMatch(/1\.234,50/);
  });
});
