import { integrationOrigins, connectionSiteOrigin } from "../_shared/integration-origins.ts";
import { createBackendClient, resolveAwsS3Config } from "../_shared/aws-backend.ts";
import { createAdminHandler } from "./handler.ts";
const db = createBackendClient();
// The directory must include existing S3 files, not only uploads made since quotas were added.
async function refreshStorage(users: string[]) {
  const config = await resolveAwsS3Config(db).catch(() => null);
  if (!config) throw new Error("storage_config_unavailable");
  if (!config.bucket) return;
  for (let start = 0; start < users.length; start += 4) {
    await Promise.all(users.slice(start, start + 4).map(async id => {
      const result = await db.functions.invoke("s3-storage", { body: { action: "quota", bucket: "media", path: `${id}/quota` } });
      if (result.error || result.data?.error) throw new Error("storage_usage_unavailable");
    }));
  }
}
Deno.serve(createAdminHandler(db, refreshStorage, integrationOrigins(Deno.env.get("AVANCA_EXTRA_ORIGINS"), connectionSiteOrigin(Deno.env.get("AVANCA_SITE_ORIGIN")))));
