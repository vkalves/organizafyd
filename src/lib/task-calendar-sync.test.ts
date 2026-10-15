import { afterEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/features/google-calendar/api", () => ({ requestTaskCalendarSync: request }));

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  request.mockReset();
});

describe("task calendar sync scheduling", () => {
  it("coalesces task autosaves into one request", async () => {
    vi.useFakeTimers();
    request.mockResolvedValue(null);
    const { scheduleTaskCalendarSync } = await import("./task-calendar-sync");
    scheduleTaskCalendarSync();
    await vi.advanceTimersByTimeAsync(500);
    scheduleTaskCalendarSync();
    await vi.advanceTimersByTimeAsync(799);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not lose edits received while a request is running", async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    request.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; }))
      .mockResolvedValue(null);
    const { scheduleTaskCalendarSync } = await import("./task-calendar-sync");
    scheduleTaskCalendarSync();
    await vi.advanceTimersByTimeAsync(800);
    scheduleTaskCalendarSync();
    scheduleTaskCalendarSync();
    await vi.advanceTimersByTimeAsync(2000);
    expect(request).toHaveBeenCalledTimes(1);
    complete();
    await vi.advanceTimersByTimeAsync(800);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("recovers after a Google failure without rejecting task operations", async () => {
    vi.useFakeTimers();
    request.mockRejectedValueOnce(new Error("Google unavailable")).mockResolvedValue(null);
    const { scheduleTaskCalendarSync } = await import("./task-calendar-sync");
    expect(() => scheduleTaskCalendarSync()).not.toThrow();
    await vi.advanceTimersByTimeAsync(800);
    scheduleTaskCalendarSync();
    await vi.advanceTimersByTimeAsync(800);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
