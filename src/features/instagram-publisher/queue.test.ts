import { describe, expect, it } from "vitest";
import {
  drainQueue,
  readPages,
  stageJobs,
} from "../../../supabase/functions/instagram-publisher/queue";
import {
  buildFlow,
  type FlowInput,
} from "../../../supabase/functions/instagram-publisher/flow";
describe("bounded queue preparation and execution", () => {
  it("streams 10000 items in bounded payloads", async () => {
    let count = 0, largest = 0;
    function* jobs() {
      for (let i = 0; i < 10000; i++) yield i;
    }
    const plan = await stageJobs(jobs(), async (batch) => {
      count += batch.jobs.length;
      largest = Math.max(largest, batch.jobs.length);
    });
    expect(count).toBe(10000);
    expect(largest).toBe(200);
    expect(plan.batches).toBe(50);
  });
  it("never commits a partially generated plan", async () => {
    function* jobs() {
      yield 1;
      throw new Error("invalid_media");
    }
    await expect(stageJobs(jobs(), async () => {})).rejects.toThrow(
      "invalid_media",
    );
  });
  it("limits concurrent work and keeps other accounts running after an error", async () => {
    let active = 0, max = 0, calls = 0;
    const result = await drainQueue(async () => {
      const n = ++calls;
      active++;
      max = Math.max(max, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      if (n === 1) throw new Error("offline");
      return { processed: 1 };
    }, { maxJobs: 24, concurrency: 4 });
    expect(max).toBeLessThanOrEqual(4);
    expect(calls).toBe(24);
    expect(result).toEqual({ processed: 23, errors: 1 });
  });
  it("stops claiming when the tick budget expires", async () => {
    let time = 0, calls = 0;
    await drainQueue(async () => {
      calls++;
      time += 100;
      return { processed: 1 };
    }, { concurrency: 1, budgetMs: 200, now: () => time });
    expect(calls).toBe(2);
  });
  it("reads beyond the first database page", async () => {
    const values = Array.from({ length: 1501 }, (_, i) => i);
    expect(await readPages(async (from, to) => values.slice(from, to + 1)))
      .toEqual(values);
  });
  it("builds more than 500 publications across accounts", () => {
    const user = crypto.randomUUID();
    const media = Array.from(
      { length: 600 },
      () => ({
        id: crypto.randomUUID(),
        url: `storage://${user}/${crypto.randomUUID()}.mp4`,
        kind: "posts",
        caption: "",
      }),
    );
    const input: FlowInput = {
      id: crypto.randomUUID(),
      name: "Large",
      accountIds: Array.from({ length: 10 }, () => crypto.randomUUID()),
      mediaIds: media.map((m) => m.id),
      gapMinutes: 3,
      random: true,
      distribution: "all",
      format: "auto",
      kind: "posts",
      caption: "",
      variations: [],
      startAt: null,
      coverId: null,
    };
    expect(buildFlow(input, media, user)).toHaveLength(6000);
  });
});
