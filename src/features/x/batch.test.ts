import { beforeEach, describe, expect, it, vi } from "vitest";
import { batchTimes, submitBatch, type BatchItem } from "./batch";
import { uploadFiles, xRequest } from "./api";
vi.mock("./api", () => ({ uploadFiles: vi.fn(), xRequest: vi.fn() }));
const row = (id: string): BatchItem => ({
  id,
  file: new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
  text: id,
  state: "waiting",
  scheduledAt: "2026-12-01T15:00:00Z",
});
beforeEach(() => {
  vi.mocked(uploadFiles)
    .mockReset()
    .mockResolvedValue([
      { path: "user/clean.jpg", name: "midia.jpg", type: "image/jpeg" },
    ]);
  vi.mocked(xRequest).mockReset().mockResolvedValue({ success: true });
});
describe("batch scheduling", () => {
  it("spaces dates across midnight and rejects invalid dates before upload", () => {
    expect(
      batchTimes(
        "2026-10-17T23:00:00Z",
        180,
        3,
        Date.parse("2026-10-17T10:00:00Z"),
      ),
    ).toEqual([
      "2026-10-17T23:00:00.000Z",
      "2026-10-18T02:00:00.000Z",
      "2026-10-18T05:00:00.000Z",
    ]);
    expect(() => batchTimes("invalid", 180, 2)).toThrow();
    expect(() =>
      batchTimes("2026-01-01T00:00:00Z", 180, 2, Date.parse("2026-02-01")),
    ).toThrow();
  });
  it("continues after a failure and retries only pending rows with identical UUID and media", async () => {
    const rows = [row("first"), row("second")];
    vi.mocked(xRequest).mockRejectedValueOnce(
      new Error("Network response lost"),
    );
    await submitBatch(rows, "account", "user", vi.fn());
    expect(rows.map((r) => r.state)).toEqual(["error", "scheduled"]);
    const original = vi.mocked(xRequest).mock.calls[0][1];
    await submitBatch(rows, "account", "user", vi.fn());
    expect(uploadFiles).toHaveBeenCalledTimes(2);
    expect(xRequest).toHaveBeenCalledTimes(3);
    expect(vi.mocked(xRequest).mock.calls[2][1]).toEqual(original);
    expect(rows.map((r) => r.state)).toEqual(["scheduled", "scheduled"]);
  });
  it("never schedules a file when cleaning/upload fails", async () => {
    vi.mocked(uploadFiles).mockRejectedValueOnce(new Error("Cleaning failed"));
    const rows = [row("first")];
    await submitBatch(rows, "account", "user", vi.fn());
    expect(xRequest).not.toHaveBeenCalled();
    expect(rows[0].state).toBe("error");
  });
  it("stops between items and leaves remaining rows available for continuation", async () => {
    const rows = [row("first"), row("second")];
    await submitBatch(
      rows,
      "account",
      "user",
      vi.fn(),
      () => rows[0].state === "scheduled",
    );
    expect(rows.map((r) => r.state)).toEqual(["scheduled", "waiting"]);
  });
});
