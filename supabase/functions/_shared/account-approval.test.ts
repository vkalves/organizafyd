import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { requireApprovedAccount } from "./account-approval.ts";

Deno.test("approval guard checks the verified user's status and fails closed", async () => {
  for (const status of ["approved", "pending", "rejected", null, "rpc-error"]) {
    let rpcCalled = false;
    const client = createClient("https://example.test", "test-key", { auth: { persistSession: false, autoRefreshToken: false }, global: {
      fetch: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "verified-user", aud: "authenticated" }), { headers: { "Content-Type": "application/json" } });
        if (url.endsWith("/rest/v1/rpc/avanca_account_status")) {
          rpcCalled = true;
          if (JSON.parse(String(init?.body)).p_user !== "verified-user") throw new Error("unverified target");
          return new Response(JSON.stringify(status === "rpc-error" ? { message: "database error" } : status), { status: status === "rpc-error" ? 500 : 200, headers: { "Content-Type": "application/json" } });
        }
        throw new Error("Unexpected request");
      },
    } });
    requireApprovedAccount(client);
    const result = await client.auth.getUser("fixture-jwt");
    if (!rpcCalled) throw new Error("approval lookup was skipped");
    if (status === "approved") {
      if (result.error || result.data.user?.id !== "verified-user") throw new Error("approved user blocked");
    } else if (!result.error || result.data.user !== null) throw new Error("unapproved user allowed");
  }
});
