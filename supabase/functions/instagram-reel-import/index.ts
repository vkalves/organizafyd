import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { requireApprovedAccount } from "../_shared/account-approval.ts";
import { createReelImportHandler } from "./handler.ts";

const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
requireApprovedAccount(client);
Deno.serve(createReelImportHandler(async token => {
  const { data, error } = await client.auth.getUser(token);
  return !error && !!data.user;
}));
