import { integrationOrigins, connectionSiteOrigin } from "../_shared/integration-origins.ts";
import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { createAdminHandler } from "./handler.ts";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
// The directory must include existing S3 files, not only uploads made since quotas were added.
async function refreshStorage(users: string[]) {
  const config = await db.rpc("aws_storage_config");
  if (config.error) throw new Error("storage_config_unavailable");
  if (!config.data?.bucket) return; // Supabase-only installations need no S3 inventory.
  for (let start = 0; start < users.length; start += 4) {
    await Promise.all(users.slice(start, start + 4).map(async id => {
      const result = await db.functions.invoke("s3-storage", { body: { action: "quota", bucket: "media", path: `${id}/quota` } });
      if (result.error || result.data?.error) throw new Error("storage_usage_unavailable");
    }));
  }
}
Deno.serve(createAdminHandler(db, refreshStorage, integrationOrigins(Deno.env.get("AVANCA_EXTRA_ORIGINS"), connectionSiteOrigin(Deno.env.get("AVANCA_SITE_ORIGIN")))));
