import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { createGoogleCalendarHandler } from "./handler.ts";
import { SupabaseCalendarStore } from "./store.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(createGoogleCalendarHandler({
  store: new SupabaseCalendarStore(supabase),
  config: {
    supabaseUrl: Deno.env.get("SUPABASE_URL"),
    clientId: Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID"),
    clientSecret: Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET"),
    appUrl: Deno.env.get("GOOGLE_CALENDAR_APP_URL"),
    encryptionKey: Deno.env.get("GOOGLE_CALENDAR_ENCRYPTION_KEY"),
    workerSecret: Deno.env.get("GOOGLE_CALENDAR_WORKER_SECRET"),
  },
}));
