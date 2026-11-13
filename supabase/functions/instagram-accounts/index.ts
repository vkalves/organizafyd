import { integrationOrigins, connectionSiteOrigin } from "../_shared/integration-origins.ts";
import { requireApprovedAccount } from "../_shared/account-approval.ts";
import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { accountHandler, type AccountRepository } from "./handler.ts";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
requireApprovedAccount(db);
function checked<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(["account_busy", "account_not_found"].includes(error.message) ? error.message : "request_failed");
  return data;
}
const repository: AccountRepository = {
  async authenticate(jwt) {
    const { data, error } = await db.auth.getUser(jwt);
    return error ? null : data.user?.id || null;
  },
  async connections(userId, ids) {
    return checked(await db.from("ig_publisher_connections").select("account_id,graph_id,secret_id,provider").eq("user_id", userId).in("account_id", ids)) || [];
  },
  async photos(userId, ids) {
    return (checked(await db.from("instagram_accounts").select("id,avatar_url").eq("user_id", userId).in("id", ids)) || []).map((row) => ({ account_id: row.id, avatar_url: row.avatar_url }));
  },
  async token(secretId) {
    const token = checked(await db.rpc("ig_vault_read", { p_id: secretId }));
    if (typeof token !== "string" || !token) throw new Error("credential_missing");
    return token;
  },
  async savePhoto(userId, accountId, url) {
    checked(await db.from("instagram_accounts").update({ avatar_url: url }).eq("id", accountId).eq("user_id", userId));
  },
  async disconnect(userId, accountId) {
    checked(await db.rpc("ig_disconnect_account", { p_user: userId, p_account: accountId }));
  },
};
Deno.serve(accountHandler(repository, fetch, integrationOrigins(Deno.env.get("AVANCA_EXTRA_ORIGINS"), connectionSiteOrigin(Deno.env.get("AVANCA_SITE_ORIGIN")))));
