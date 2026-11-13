import { requireApprovedAccount } from "../_shared/account-approval.ts";
import { hybridStorage } from '../_shared/hybrid-storage.ts';
import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { createXHandler } from "./handler.ts";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
requireApprovedAccount(db);
const fileStorage = hybridStorage(db, Deno.env.get("SUPABASE_URL")!);
Deno.serve(
  createXHandler(new Proxy(db, { get(target, prop) { return prop === "storage" ? fileStorage : Reflect.get(target, prop); } }), {
    appUrl: Deno.env.get("X_APP_URL"),
    supabaseUrl: Deno.env.get("SUPABASE_URL"),
    clientId: Deno.env.get("X_CLIENT_ID"),
    clientSecret: Deno.env.get("X_CLIENT_SECRET"),
    encryptionKey: Deno.env.get("X_ENCRYPTION_KEY"),
    workerSecret: Deno.env.get("X_WORKER_SECRET"),
  }),
);
