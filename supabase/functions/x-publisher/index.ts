import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { createXHandler } from "./handler.ts";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
Deno.serve(
  createXHandler(db, {
    appUrl: Deno.env.get("X_APP_URL"),
    supabaseUrl: Deno.env.get("SUPABASE_URL"),
    clientId: Deno.env.get("X_CLIENT_ID"),
    clientSecret: Deno.env.get("X_CLIENT_SECRET"),
    encryptionKey: Deno.env.get("X_ENCRYPTION_KEY"),
    workerSecret: Deno.env.get("X_WORKER_SECRET"),
  }),
);
