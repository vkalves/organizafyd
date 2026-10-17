import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { createTikTokHandler } from "./handler.ts";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
Deno.serve(
  createTikTokHandler(db, {
    appUrl: Deno.env.get("TIKTOK_APP_URL"),
    supabaseUrl: Deno.env.get("SUPABASE_URL"),
    clientId: Deno.env.get("TIKTOK_CLIENT_KEY"),
    clientSecret: Deno.env.get("TIKTOK_CLIENT_SECRET"),
    encryptionKey: Deno.env.get("TIKTOK_ENCRYPTION_KEY"),
    workerSecret: Deno.env.get("TIKTOK_WORKER_SECRET"),
  }),
);
