import { requireApprovedAccount } from "../_shared/account-approval.ts";
import { createBackendClient } from "../_shared/aws-backend.ts";
import { createGoogleCalendarHandler } from "./handler.ts";
import { SupabaseCalendarStore } from "./store.ts";

const supabase = createBackendClient();
requireApprovedAccount(supabase);

Deno.serve(createGoogleCalendarHandler({
  store: new SupabaseCalendarStore(supabase),
  config: {
    supabaseUrl: Deno.env.get("AWS_API_URL") || Deno.env.get("SUPABASE_URL"),
    clientId: Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID"),
    clientSecret: Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET"),
    appUrl: Deno.env.get("GOOGLE_CALENDAR_APP_URL"),
    encryptionKey: Deno.env.get("GOOGLE_CALENDAR_ENCRYPTION_KEY"),
    workerSecret: Deno.env.get("GOOGLE_CALENDAR_WORKER_SECRET"),
  },
}));
