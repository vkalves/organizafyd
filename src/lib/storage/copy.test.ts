// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { copyStoredObject, recentInventories } from "../../../supabase/functions/s3-storage/copy";
import { validServerCopy } from "../../../supabase/functions/s3-storage/policy";
const user = "11111111-1111-4111-8111-111111111111";
const source = { size: 100_000_000, type: "video/mp4", etag: '"source-etag"' };
function dependencies() {
  return { inspect: vi.fn().mockResolvedValue(source), inventory: vi.fn().mockResolvedValue(undefined), reserve: vi.fn().mockResolvedValue(null),
    copy: vi.fn().mockResolvedValue(undefined), legacyCopy: vi.fn().mockResolvedValue(undefined), cleanup: vi.fn().mockResolvedValue(undefined) };
}
describe("server storage copies", () => {
  it("requires service credentials and safe, distinct paths", () => {
    expect(validServerCopy(false, `${user}/a.mp4`, `${user}/b.mp4`)).toBe(false);
    expect(validServerCopy(true, `${user}/../a.mp4`, `${user}/b.mp4`)).toBe(false);
    expect(validServerCopy(true, `${user}/a.mp4`, `${user}/a.mp4`)).toBe(false);
    expect(validServerCopy(true, `${user}/a.mp4`, `${user}/b.mp4`)).toBe(true);
  });
  it("reserves actual source bytes and conditions the copy on the inspected version", async () => {
    const deps = dependencies(); await copyStoredObject("instagram-publisher", deps);
    expect(deps.reserve).toHaveBeenCalledWith(source.size);
    expect(deps.copy).toHaveBeenCalledWith(source);
    expect(deps.inventory.mock.invocationCallOrder[0]).toBeLessThan(deps.reserve.mock.invocationCallOrder[0]);
    expect(deps.reserve.mock.invocationCallOrder[0]).toBeLessThan(deps.copy.mock.invocationCallOrder[0]);
    expect(deps.legacyCopy).not.toHaveBeenCalled();
  });
  it("does not copy when the quota is exhausted", async () => {
    const deps = dependencies(); deps.reserve.mockResolvedValue("storage_quota_exceeded");
    await expect(copyStoredObject("instagram-publisher", deps)).rejects.toThrow("storage_quota_exceeded");
    expect(deps.copy).not.toHaveBeenCalled(); expect(deps.cleanup).not.toHaveBeenCalled();
  });
  it.each([{ ...source, size: 104857601 }, { ...source, type: "text/html" }, { ...source, etag: "" }])("rejects invalid sources before reserving: %j", async input => {
    const deps = dependencies(); deps.inspect.mockResolvedValue(input);
    await expect(copyStoredObject("instagram-publisher", deps)).rejects.toThrow("invalid_upload");
    expect(deps.reserve).not.toHaveBeenCalled(); expect(deps.copy).not.toHaveBeenCalled();
  });
  it("cleans up ambiguous copy outcomes and preserves the original error", async () => {
    const deps = dependencies(); deps.copy.mockRejectedValue(new Error("source_changed")); deps.cleanup.mockRejectedValue(new Error("cleanup_failed"));
    await expect(copyStoredObject("instagram-publisher", deps)).rejects.toThrow("source_changed");
    expect(deps.cleanup).toHaveBeenCalledOnce();
  });
  it("uses the Supabase native copy for legacy files without downloading bytes", async () => {
    const deps = dependencies(); deps.inspect.mockResolvedValue(null);
    await copyStoredObject("instagram-publisher", deps);
    expect(deps.legacyCopy).toHaveBeenCalledOnce(); expect(deps.copy).not.toHaveBeenCalled(); expect(deps.reserve).not.toHaveBeenCalled();
  });
  it("does not silently fall back if S3 inspection fails", async () => {
    const deps = dependencies(); deps.inspect.mockRejectedValue(new Error("aws_unavailable"));
    await expect(copyStoredObject("instagram-publisher", deps)).rejects.toThrow("aws_unavailable");
    expect(deps.legacyCopy).not.toHaveBeenCalled();
  });
  it("shares an in-flight inventory and refreshes after expiry", async () => {
    let now = 0; const cached = recentInventories(30_000, () => now);
    let resolve!: () => void; const sync = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const first = cached(user, sync), second = cached(user, sync);
    await Promise.resolve(); expect(sync).toHaveBeenCalledOnce();
    resolve(); await Promise.all([first, second]);
    await cached(user, sync); expect(sync).toHaveBeenCalledOnce();
    now = 30_001; sync.mockResolvedValue(undefined);
    await cached(user, sync); expect(sync).toHaveBeenCalledTimes(2);
  });
  it("retries a failed inventory instead of caching the failure", async () => {
    const cached = recentInventories(), sync = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(undefined);
    await expect(cached(user, sync)).rejects.toThrow(); await cached(user, sync); expect(sync).toHaveBeenCalledTimes(2);
  });
});
