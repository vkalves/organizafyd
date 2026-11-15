import { describe, expect, it } from "vitest";
import { runAccountBatch, workerPartition } from "../../../supabase/functions/_shared/publisher-workers";
import { drainQueue } from "../../../supabase/functions/instagram-publisher/queue";

describe("platform worker limits", () => {
  it.each([{shard:-1,shards:8},{shard:8,shards:8},{shard:0,shards:9},{shard:0,shards:0},{shard:0.1,shards:2},{shard:"0",shards:2}])("rejects invalid partition %j", input => {
    expect(() => workerPartition(input)).toThrow("invalid_worker_partition");
  });
  it("keeps old cron requests compatible", () => {
    expect(workerPartition({})).toEqual({shard:0,shards:1});
  });
  it("runs 1000 accounts once with bounded parallelism", async () => {
    let active=0, peak=0;
    const visited = new Set<number>();
    await runAccountBatch(Array.from({length:1000},(_,i)=>i), async id => {
      active++; peak=Math.max(peak,active);
      await Promise.resolve();
      visited.add(id); active--;
    });
    expect(visited.size).toBe(1000);
    expect(peak).toBe(4);
  });
  it("keeps healthy accounts moving while one account is slow", async () => {
    let release!:()=>void;
    const slow=new Promise<void>(resolve=>{release=resolve;});
    const visited:number[]=[];
    const task=runAccountBatch([0,1,2,3,4,5], async id => {
      if(id===0) await slow;
      visited.push(id);
      if(id===5) release();
    },2);
    await task;
    expect(visited).toEqual([1,2,3,4,5,0]);
  });
  it("bounds each of eight worker partitions to 120 operations", async () => {
    let calls=0;
    const results=await Promise.all(Array.from({length:8},()=>drainQueue(async()=>{
      calls++; return {processed:1};
    },{maxJobs:120})));
    expect(calls).toBe(960);
    expect(results.every(r=>r.processed===120)).toBe(true);
  });
});
