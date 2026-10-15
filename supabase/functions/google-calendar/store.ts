import type { SupabaseClient } from "npm:@supabase/supabase-js@2.98.0";
import type { CalendarConnection, CalendarStore, EventMapping, OAuthState, QueueItem, Task } from "./types.ts";

function check(error: { message: string } | null): void {
  // Database messages may contain sensitive input; callers only return a fixed public error.
  if (error) throw new Error("calendar_storage_failed");
}

export class SupabaseCalendarStore implements CalendarStore {
  constructor(private client: SupabaseClient) {}

  async authenticate(token: string): Promise<string | null> {
    const { data, error } = await this.client.auth.getUser(token);
    return error ? null : data.user?.id ?? null;
  }

  async connection(userId: string): Promise<CalendarConnection | null> {
    const { data, error } = await this.client.from("google_calendar_connections").select("*").eq("user_id", userId).maybeSingle();
    check(error);
    return data;
  }

  async saveConnection(connection: Partial<CalendarConnection> & { user_id: string }): Promise<void> {
    const existing = await this.connection(connection.user_id);
    const query = this.client.from("google_calendar_connections");
    const { error } = existing
      ? await query.update(connection).eq("user_id", connection.user_id)
      : await query.insert(connection);
    check(error);
  }

  async putState(state: OAuthState): Promise<void> {
    const { error } = await this.client.from("google_calendar_oauth_states").insert(state);
    check(error);
  }

  async state(hash: string, now: string): Promise<OAuthState | null> {
    const { data, error } = await this.client.from("google_calendar_oauth_states").select("*").eq("state_hash", hash).gt("expires_at", now).maybeSingle();
    check(error);
    return data;
  }

  async consumeState(hash: string, userId: string, now: string): Promise<OAuthState | null> {
    const { data, error } = await this.client.from("google_calendar_oauth_states").delete().eq("state_hash", hash).eq("user_id", userId).gt("expires_at", now).select().maybeSingle();
    check(error);
    return data;
  }

  async enqueueAll(userId: string): Promise<void> {
    const { error } = await this.client.rpc("google_calendar_enqueue_all", { p_user_id: userId });
    check(error);
  }

  async selectCalendar(userId: string, calendarId: string, summary: string): Promise<void> {
    const { error } = await this.client.rpc("google_calendar_select_calendar", { p_user_id: userId, p_calendar_id: calendarId, p_calendar_summary: summary });
    check(error);
  }

  async claimLock(userId: string, lockToken: string, leaseSeconds: number): Promise<boolean> {
    const { data, error } = await this.client.rpc("google_calendar_claim_lock", { p_user_id: userId, p_lock_token: lockToken, p_lease_seconds: leaseSeconds });
    check(error);
    return data === true;
  }

  async releaseLock(userId: string, lockToken: string): Promise<void> {
    const { error } = await this.client.rpc("google_calendar_release_lock", { p_user_id: userId, p_lock_token: lockToken });
    check(error);
  }

  async pendingCount(userId: string): Promise<number> {
    const { count, error } = await this.client.from("google_calendar_sync_queue").select("task_id", { count: "exact", head: true }).eq("user_id", userId);
    check(error);
    return count ?? 0;
  }

  async queue(userId: string, now: string, limit: number): Promise<QueueItem[]> {
    const { data, error } = await this.client.from("google_calendar_sync_queue").select("*").eq("user_id", userId).lte("next_attempt_at", now).order("next_attempt_at").limit(limit);
    check(error);
    return data ?? [];
  }

  async dueUsers(now: string, limit: number): Promise<string[]> {
    const { data, error } = await this.client.rpc("google_calendar_due_users", { p_now: now, p_limit: limit });
    check(error);
    return (data ?? []).map((item: { user_id: string }) => item.user_id);
  }

  async task(userId: string, taskId: string): Promise<Task | null> {
    const { data, error } = await this.client.from("tasks").select("id,user_id,title,description,due_date,status").eq("user_id", userId).eq("id", taskId).maybeSingle();
    check(error);
    return data;
  }

  async mapping(userId: string, taskId: string): Promise<EventMapping | null> {
    const { data, error } = await this.client.from("google_calendar_task_events").select("*").eq("user_id", userId).eq("task_id", taskId).maybeSingle();
    check(error);
    return data;
  }

  async mappings(userId: string): Promise<EventMapping[]> {
    const { data, error } = await this.client.from("google_calendar_task_events").select("*").eq("user_id", userId);
    check(error);
    return data ?? [];
  }

  async saveMapping(mapping: EventMapping): Promise<void> {
    const { error } = await this.client.from("google_calendar_task_events").upsert(mapping, { onConflict: "user_id,task_id" });
    check(error);
  }

  async removeMapping(userId: string, taskId: string): Promise<void> {
    const { error } = await this.client.from("google_calendar_task_events").delete().eq("user_id", userId).eq("task_id", taskId);
    check(error);
  }

  async dropForeignMappings(userId: string, calendarId: string): Promise<void> {
    const { error } = await this.client.from("google_calendar_task_events").delete().eq("user_id", userId).neq("calendar_id", calendarId);
    check(error);
  }

  async clearMappings(userId: string): Promise<void> {
    const { error } = await this.client.from("google_calendar_task_events").delete().eq("user_id", userId);
    check(error);
  }

  async completeJob(item: QueueItem): Promise<void> {
    const { error } = await this.client.from("google_calendar_sync_queue").delete().eq("user_id", item.user_id).eq("task_id", item.task_id).eq("revision", item.revision);
    check(error);
  }

  async failJob(item: QueueItem, errorCode: string, nextAttempt: string): Promise<void> {
    const { error } = await this.client.from("google_calendar_sync_queue").update({ attempts: item.attempts + 1, last_error: errorCode, next_attempt_at: nextAttempt }).eq("user_id", item.user_id).eq("task_id", item.task_id).eq("revision", item.revision);
    check(error);
  }

  async disconnect(userId: string): Promise<void> {
    // Keep mappings for retained Google events, preventing duplicates on reconnection.
    const { error } = await this.client.rpc("google_calendar_disconnect", { p_user_id: userId });
    check(error);
  }
}
