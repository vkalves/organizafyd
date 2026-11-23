import { createBackendClient } from "../_shared/aws-backend.ts";
import { requireApprovedAccount } from "../_shared/account-approval.ts";
import { createReelImportHandler } from "./handler.ts";

const client = createBackendClient();
requireApprovedAccount(client);
Deno.serve(createReelImportHandler(async token => {
  const { data, error } = await client.auth.getUser(token);
  return !error && !!data.user;
}));
