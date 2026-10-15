import { requestTaskCalendarSync } from "@/features/google-calendar/api";

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let pending = false;

async function flush() {
  timer = undefined;
  if (running || !pending) return;
  pending = false;
  running = true;
  try {
    await requestTaskCalendarSync();
  } catch {
    // The task is already saved and its durable database job remains queued.
    // Google failures must not make a successful task save look unsuccessful.
  } finally {
    running = false;
    if (pending) timer = setTimeout(() => void flush(), 800);
  }
}

/** Coalesce autosaves and serialize requests; cron also retries durable jobs. */
export function scheduleTaskCalendarSync() {
  pending = true;
  if (running) return;
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => void flush(), 800);
}
