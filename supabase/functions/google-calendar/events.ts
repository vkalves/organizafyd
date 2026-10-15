import { sha256 } from "./crypto.ts";
import type { QueueItem, Task } from "./types.ts";

export function nextDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid task date");
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("Invalid task date");
  }
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/** Stable across retries of one queue generation; fresh after a deleted Google tombstone. */
export async function eventId(taskId: string, generation: string): Promise<string> {
  return `org${taskId.replace(/-/g, "").toLowerCase()}${(await sha256(generation)).slice(0, 16)}`;
}

export function eventPayload(task: Task, appUrl: string) {
  if (!task.due_date) throw new Error("Task has no date");
  const link = new URL("/tarefas", appUrl);
  link.searchParams.set("task", task.id);
  return {
    summary: `${task.status === "done" ? "✓ " : ""}${task.title}`,
    description: [task.description?.trim(), `Tarefa no Organizafy: ${link.href}`].filter(Boolean).join("\n\n"),
    start: { date: task.due_date },
    end: { date: nextDate(task.due_date) },
    transparency: "transparent",
    extendedProperties: { private: { organizafy_task_id: task.id } },
  };
}

export function retryDate(item: QueueItem, now: Date): string {
  const seconds = Math.min(3600, 30 * 2 ** Math.min(item.attempts, 7));
  return new Date(now.getTime() + seconds * 1000).toISOString();
}
