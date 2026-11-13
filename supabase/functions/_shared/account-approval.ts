import { AuthError, type SupabaseClient } from "npm:@supabase/supabase-js@2.98.0";

// Install only on user-facing service clients. app-admin must remain accessible
// to pending users so they can read their own approval status.
export function requireApprovedAccount(client: SupabaseClient): void {
  const getUser = client.auth.getUser.bind(client.auth);
  client.auth.getUser = async (jwt?: string) => {
    const result = await getUser(jwt);
    if (result.error || !result.data.user) return result;
    const { data, error } = await client.rpc("avanca_account_status", { p_user: result.data.user.id });
    if (error || data !== "approved") {
      return { data: { user: null }, error: new AuthError("account_not_approved", 403) };
    }
    return result;
  };
}
