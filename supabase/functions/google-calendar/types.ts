export interface CalendarConnection {
  user_id: string;
  calendar_id: string;
  calendar_summary: string;
  google_account_id: string | null;
  refresh_token_encrypted: string;
  access_token_encrypted: string | null;
  token_expires_at: string | null;
  last_synced_at: string | null;
  sync_error: string | null;
  reconnect_required: boolean;
}

export interface OAuthState {
  state_hash: string;
  user_id: string;
  code_verifier_encrypted: string;
  expires_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: string | null;
}

export interface QueueItem {
  user_id: string;
  task_id: string;
  revision: number;
  attempts: number;
  created_at: string;
}

export interface EventMapping {
  user_id: string;
  task_id: string;
  calendar_id: string;
  event_id: string;
  synced_at: string;
}

export interface Calendar {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: string;
}

/** Service-role storage only: no browser can read tokens, OAuth state or the queue. */
export interface CalendarStore {
  authenticate(token: string): Promise<string | null>;
  connection(userId: string): Promise<CalendarConnection | null>;
  saveConnection(connection: Partial<CalendarConnection> & { user_id: string }): Promise<void>;
  putState(state: OAuthState): Promise<void>;
  state(hash: string, now: string): Promise<OAuthState | null>;
  consumeState(hash: string, userId: string, now: string): Promise<OAuthState | null>;
  enqueueAll(userId: string): Promise<void>;
  selectCalendar(userId: string, calendarId: string, summary: string): Promise<void>;
  claimLock(userId: string, lockToken: string, leaseSeconds: number): Promise<boolean>;
  releaseLock(userId: string, lockToken: string): Promise<void>;
  pendingCount(userId: string): Promise<number>;
  queue(userId: string, now: string, limit: number): Promise<QueueItem[]>;
  dueUsers(now: string, limit: number): Promise<string[]>;
  task(userId: string, taskId: string): Promise<Task | null>;
  mapping(userId: string, taskId: string): Promise<EventMapping | null>;
  mappings(userId: string): Promise<EventMapping[]>;
  saveMapping(mapping: EventMapping): Promise<void>;
  removeMapping(userId: string, taskId: string): Promise<void>;
  dropForeignMappings(userId: string, calendarId: string): Promise<void>;
  clearMappings(userId: string): Promise<void>;
  completeJob(item: QueueItem): Promise<void>;
  failJob(item: QueueItem, error: string, nextAttempt: string): Promise<void>;
  disconnect(userId: string): Promise<void>;
}

export interface CalendarConfig {
  supabaseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  appUrl?: string;
  encryptionKey?: string;
  workerSecret?: string;
}

export interface Dependencies {
  store: CalendarStore;
  config: CalendarConfig;
  fetch?: typeof fetch;
  now?: () => Date;
}

export class CalendarError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}
