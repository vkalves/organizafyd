import { requireApprovedAccount } from "../_shared/account-approval.ts";
import { createBackendClient } from "../_shared/aws-backend.ts";
import { hybridStorage } from '../_shared/hybrid-storage.ts';
import { createXHandler } from "./handler.ts";
const apiUrl = (Deno.env.get("AWS_API_URL") || Deno.env.get("SUPABASE_URL"))!;
const db = createBackendClient();
requireApprovedAccount(db);
const fileStorage = hybridStorage(db, apiUrl);
Deno.serve(
  createXHandler(new Proxy(db, { get(target, prop) { return prop === "storage" ? fileStorage : Reflect.get(target, prop); } }), {
    appUrl: Deno.env.get("X_APP_URL"),
    supabaseUrl: apiUrl,
    clientId: Deno.env.get("X_CLIENT_ID"),
    clientSecret: Deno.env.get("X_CLIENT_SECRET"),
    encryptionKey: Deno.env.get("X_ENCRYPTION_KEY"),
    workerSecret: Deno.env.get("X_WORKER_SECRET"),
  }),
);
