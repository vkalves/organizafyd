export type WorkerPartition = { shard: number; shards: number };
export function workerPartition(input: { shard?: unknown; shards?: unknown }): WorkerPartition {
  const shard = input.shard ?? 0, shards = input.shards ?? 1;
  if (!Number.isInteger(shard) || !Number.isInteger(shards) ||
    (shards as number) < 1 || (shards as number) > 8 ||
    (shard as number) < 0 || (shard as number) >= (shards as number)) {
    throw new Error("invalid_worker_partition");
  }
  return { shard: shard as number, shards: shards as number };
}

// One slow account occupies one lane, rather than stopping all other accounts.
export async function runAccountBatch<T>(items: T[], process: (item: T) => Promise<void>, concurrency = 4) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) await process(items[cursor++]);
  }));
}
