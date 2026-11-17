import {
  connectionSiteOrigin,
  integrationOrigins,
} from "../_shared/integration-origins.ts";
import { requireApprovedAccount } from "../_shared/account-approval.ts";
import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { createMonitorRepository } from "./repository.ts";
import { monitorHandler } from "./handler.ts";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
requireApprovedAccount(db);

Deno.serve(
  monitorHandler(
    createMonitorRepository(db),
    integrationOrigins(
      Deno.env.get("AVANCA_EXTRA_ORIGINS"),
      connectionSiteOrigin(Deno.env.get("AVANCA_SITE_ORIGIN")),
    ),
  ),
);
