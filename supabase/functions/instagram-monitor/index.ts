import {
  connectionSiteOrigin,
  integrationOrigins,
} from "../_shared/integration-origins.ts";
import { requireApprovedAccount } from "../_shared/account-approval.ts";
import { createBackendClient } from "../_shared/aws-backend.ts";
import { createMonitorRepository } from "./repository.ts";
import { monitorHandler } from "./handler.ts";
const db = createBackendClient();
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
