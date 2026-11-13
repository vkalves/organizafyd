// Bound network payloads and application memory independently of flow size.
export async function stageJobs<T>(
  jobs: Iterable<T>,
  write: (
    batch: { plan_id: string; batch_index: number; jobs: T[] },
  ) => Promise<void>,
  batchSize = 200,
) {
  const planId = crypto.randomUUID();
  let batch: T[] = [];
  let batches = 0;
  for (const job of jobs) {
    batch.push(job);
    if (batch.length === batchSize) {
      await write({ plan_id: planId, batch_index: batches++, jobs: batch });
      batch = [];
    }
  }
  if (batch.length) {
    await write({ plan_id: planId, batch_index: batches++, jobs: batch });
  }
  if (!batches) throw new Error("no_unused_media");
  return { plan_id: planId, batches };
}

// A failed account must not abort the rest of the tick. No unbounded Promise.all.
export async function drainQueue(
  process: () => Promise<{ processed: number }>,
  options: {
    concurrency?: number;
    maxJobs?: number;
    budgetMs?: number;
    now?: () => number;
  } = {},
) {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? 45_000);
  let started = 0, processed = 0, errors = 0;
  await Promise.all(
    Array.from({ length: options.concurrency ?? 4 }, async () => {
      while (started < (options.maxJobs ?? 24) && now() < deadline) {
        started++;
        try {
          const result = await process();
          processed += result.processed;
          if (!result.processed) break;
        } catch {
          errors++;
          // Avoid hammering the database when claims fail.
          break;
        }
      }
    }),
  );
  return { processed, errors };
}

export async function readPages<T>(
  read: (from: number, to: number) => Promise<T[]>,
  size = 500,
): Promise<T[]> {
  const result: T[] = [];
  for (let from = 0;; from += size) {
    const page = await read(from, from + size - 1);
    result.push(...page);
    if (page.length < size) return result;
  }
}
