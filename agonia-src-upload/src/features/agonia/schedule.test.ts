import { describe, expect, it } from "vitest";
import { buildSchedule, clampInterval, localToUtcIso } from "./schedule";

describe("agonia schedule", () => {
  it("converte horário de São Paulo (UTC-3) para UTC", () => {
    expect(localToUtcIso("2026-11-10T09:30", "America/Sao_Paulo")).toBe(
      "2026-11-10T12:30:00.000Z",
    );
  });
  it("respeita horário de verão em Nova York", () => {
    expect(localToUtcIso("2026-07-01T12:00", "America/New_York")).toBe(
      "2026-07-01T16:00:00.000Z",
    );
    expect(localToUtcIso("2026-12-01T12:00", "America/New_York")).toBe(
      "2026-12-01T17:00:00.000Z",
    );
  });
  it("UTC não altera", () => {
    expect(localToUtcIso("2026-11-10T09:30", "UTC")).toBe(
      "2026-11-10T09:30:00.000Z",
    );
  });
  it("rejeita data inválida", () => {
    expect(() => localToUtcIso("amanhã", "UTC")).toThrow();
  });
  it("distribui contas com intervalo", () => {
    const rows = buildSchedule(["a", "b", "c"], "2026-11-10T12:00:00.000Z", 5);
    expect(rows.map((r) => r.scheduledAt)).toEqual([
      "2026-11-10T12:00:00.000Z",
      "2026-11-10T12:05:00.000Z",
      "2026-11-10T12:10:00.000Z",
    ]);
  });
  it("limita o intervalo", () => {
    expect(clampInterval(-4)).toBe(0);
    expect(clampInterval(99999)).toBe(1440);
    expect(clampInterval("abc")).toBe(5);
  });
});
