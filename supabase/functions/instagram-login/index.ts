import { requireApprovedAccount } from "../_shared/account-approval.ts";
import { instagramAuthorizeUrl, instagramGrant } from "./instagram.ts";
import { selectConnectionApp } from "./connection-option.ts";
import { createAccountSelection, consumeAccountSelection, type SelectionStore } from "./account-selection.ts";
import { authorizeUrl, authorizedAccounts, verifyPublishingAccess, type Grant, type Profile } from "./unified.ts";
import { createClient } from "npm:@supabase/supabase-js@2.98.0";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
requireApprovedAccount(db);
const site = "https://www.organizafy.site";
const allowedOrigins = new Set(["https://xn--avana-1ra.online", "https://www.xn--avana-1ra.online", site, "https://organizafy.site", "https://organizafyd.vercel.app"]);
const callback =
  Deno.env.get("SUPABASE_URL")! + "/functions/v1/instagram-login";
const hash = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
const random = () => crypto.randomUUID() + crypto.randomUUID();
function checked({ data, error }: any) {
  if (error) throw new Error("database_error");
  return data;
}
const selectionStore: SelectionStore = {
  async insert(row) { checked(await db.from("ig_login_states").insert(row)); },
  async find(hash, proof, now) {
    return checked(await db.from("ig_login_states").select("state_hash,verifier_hash,user_id,expires_at,pending_grant")
      .eq("state_hash", hash).eq("verifier_hash", proof).gt("expires_at", now).not("pending_grant", "is", null).maybeSingle());
  },
  async consume(row, now) {
    const result = checked(await db.from("ig_login_states").delete().eq("state_hash", row.state_hash)
      .eq("verifier_hash", row.verifier_hash).eq("user_id", row.user_id).not("pending_grant", "is", null)
      .gt("expires_at", now).select("user_id"));
    return result.length === 1;
  },
};
async function saveAccount(userId: string, grant: Grant, profile: Profile) {
  const saved = grant.metaAppId ? await db.rpc("ig_connect_meta_app", {
    p_app_client_id: grant.metaAppClientId, p_config_id: grant.metaAppConfigId || null,
    p_user: userId, p_app: grant.metaAppId, p_graph: profile.id, p_username: profile.username,
    p_token: grant.token, p_business: grant.businessId || null, p_expires: grant.expiresAt,
  }) : await db.rpc("ig_connect_unified", {
    p_user: userId, p_graph: profile.id, p_username: profile.username,
    p_token: grant.token, p_business: grant.businessId, p_expires: grant.expiresAt,
  });
  if (saved.error) {
    if (["account_already_connected", "provider_conflict", "app_not_found", "account_connection_disabled", "account_limit_reached"].includes(saved.error.message)) throw new Error(saved.error.message);
    throw new Error("database_error");
  }
  return { username: profile.username };
}
async function json(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  const d = await r.json();
  if (!r.ok || d.error || d.error_type) throw new Error("meta_authorization_failed");
  return d;
}
async function loginConfigFor(userId: string, appId: string | null) {
  if (appId) {
    const app = checked(await db.rpc("ig_meta_app_config", { p_user: userId, p_id: appId }));
    if (!app || !app.active) throw new Error("app_not_found");
    return { appId: app.appId, secret: app.secret, configId: app.configId || "" };
  }
  // Platform-default connections and legacy invitations use the server-managed app.
  const old = checked(await db.rpc("ig_login_config")) || {};
  if (!old.meta_app_id || !old.meta_app_secret || !old.meta_config_id) throw new Error("not_configured");
  return { appId: old.meta_app_id, secret: old.meta_app_secret, configId: old.meta_config_id };
}
async function platformConnectionReady() {
  try { await loginConfigFor("", null); return true; }
  catch (error) {
    if (error instanceof Error && error.message === "not_configured") return false;
    throw error;
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async (req) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": allowedOrigins.has(req.headers.get("origin") || "")
      ? req.headers.get("origin")! : site,
    Vary: "Origin",
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Referrer-Policy": "no-referrer",
  };
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    const dest = new URL(site + "/instagram/conectar");
    dest.hash = new URLSearchParams(
      q.has("error")
        ? { error: "authorization_denied" }
        : { code: q.get("code") || "", state: q.get("state") || "" },
    ).toString();
    return new Response(null, {
      status: 303,
      headers: {
        Location: dest.toString(),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 12000) throw new Error("invalid_request");
    const b = JSON.parse(raw);
    if (b.action === "config" || b.action === "apps" || b.action === "save_app" || b.action === "toggle_app" || b.action === "delete_app") {
      const jwt = req.headers.get("authorization")?.replace(/^Bearer /i, "") || "";
      const { data: { user }, error } = await db.auth.getUser(jwt);
      if (error || !user) {
        if (b.action === "config") return reply({ ready: false, callback, apps: [] });
        return reply({ error: "unauthorized" }, 401);
      }
      const action = ({ save_app: "save", toggle_app: "toggle", delete_app: "delete" } as Record<string, string>)[b.action] || "list";
      if (b.id != null && (typeof b.id !== "string" || !UUID.test(b.id))) return reply({ error: "invalid_app_config" }, 400);
      const result = await db.rpc("ig_meta_apps_manage", { p_user: user.id, p_action: action, p_values: b });
      if (result.error) {
        const code = result.error.code === "23505" ? "app_exists" : result.error.message;
        if (["app_exists", "app_in_use", "app_not_found", "invalid_app_config", "app_secret_required"].includes(code)) return reply({ error: code }, 400);
        throw new Error("database_error");
      }
      const platformReady = b.action === "config" ? await platformConnectionReady() : false;
      return reply({ apps: result.data, ready: platformReady || result.data.some((app: { active: boolean }) => app.active), platformReady, callback });
    }
    if (b.action === "invite") {
      const jwt =
        req.headers.get("authorization")?.replace(/^Bearer /i, "") || "";
      const {
        data: { user },
        error,
      } = await db.auth.getUser(jwt);
      if (error || !user) return reply({ error: "unauthorized" }, 401);
      const apps = checked(await db.rpc("ig_meta_apps_manage", { p_user: user.id, p_action: "list" }));
      const app = selectConnectionApp<{ id: string; active: boolean }>(apps, b.app_id, b.app_id ? false : await platformConnectionReady());
      const token = random();
      checked(
        await db.from("ig_connection_invites").delete().eq("user_id", user.id),
      );
      checked(
        await db.from("ig_connection_invites").insert({
          token_hash: await hash(token),
          meta_app_id: app?.id ?? null,
          user_id: user.id,
          manager_label: user.email || "Administrador da conta",
        }),
      );
      return reply({ url: site + "/instagram/conectar#invite=" + token });
    }
    if (b.action === "invite_info" || b.action === "start") {
      if (typeof b.invite !== "string" || b.invite.length > 100)
        throw new Error("invalid_invite");
      const invite = checked(
        await db
          .from("ig_connection_invites")
          .select("user_id,manager_label,meta_app_id")
          .eq("token_hash", await hash(b.invite))
          .gt("expires_at", new Date().toISOString())
          .maybeSingle(),
      );
      if (!invite) throw new Error("invalid_invite");
      const loginConfig = await loginConfigFor(invite.user_id, invite.meta_app_id);
      if (b.action === "invite_info")
        return reply({ manager: invite.manager_label, provider: loginConfig.configId ? "facebook" : "instagram" });
      if (typeof b.verifier !== "string" || !/^[a-f0-9]{64}$/.test(b.verifier))
        throw new Error("invalid_state");
      const state = random();
      // Each invitation can initiate one authorization. The next attempt needs a new invitation.
      const consumed = checked(
        await db
          .from("ig_connection_invites")
          .delete()
          .eq("token_hash", await hash(b.invite))
          .select("user_id"),
      );
      if (!consumed.length) throw new Error("invalid_invite");
      checked(
        await db
          .from("ig_login_states")
          .delete()
          .lt("expires_at", new Date().toISOString()),
      );
      checked(
        await db.from("ig_login_states").insert({
          state_hash: await hash(state),
          meta_app_id: invite.meta_app_id,
          verifier_hash: await hash(b.verifier),
          user_id: invite.user_id,
        }),
      );
      return reply({ url: (loginConfig.configId ? authorizeUrl : instagramAuthorizeUrl)(loginConfig, callback, state), state });
    }
    if (b.action === "select_account") {
      const { userId, grant, profile } = await consumeAccountSelection(b.selection, b.verifier, b.account_id, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, selectionStore);
      const loginConfig = await loginConfigFor(userId, grant.metaAppId || null);
      await verifyPublishingAccess(loginConfig, grant, profile.id, json);
      return reply(await saveAccount(userId, grant, profile));
    }
    if (b.action === "finish") {
      if (
        typeof b.state !== "string" ||
        b.state.length > 100 ||
        typeof b.verifier !== "string" ||
        !/^[a-f0-9]{64}$/.test(b.verifier) ||
        typeof b.code !== "string" ||
        b.code.length > 4096
      )
        throw new Error("invalid_state");
      const states = checked(
        await db
          .from("ig_login_states")
          .delete()
          .eq("state_hash", await hash(b.state))
          .is("pending_grant", null)
          .eq("verifier_hash", await hash(b.verifier))
          .gt("expires_at", new Date().toISOString())
          .select("user_id,meta_app_id"),
      );
      if (states.length !== 1) throw new Error("invalid_state");
      const loginConfig = await loginConfigFor(states[0].user_id, states[0].meta_app_id);
      const grant: Grant = loginConfig.configId
        ? await authorizedAccounts(loginConfig, callback, b.code, json)
        : await instagramGrant(loginConfig, callback, b.code, json);
      if (states[0].meta_app_id) {
        grant.metaAppId = states[0].meta_app_id;
        grant.metaAppClientId = loginConfig.appId;
        grant.metaAppConfigId = loginConfig.configId;
      }
      if (grant.accounts.length > 1) {
        // Cached clients retain their existing behavior until the new chooser is loaded.
        if (b.allow_selection !== true) throw new Error("multiple_instagram_accounts");
        return reply(await createAccountSelection(grant, states[0].user_id, b.verifier, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, selectionStore));
      }
      const profile = grant.accounts[0];
      if (loginConfig.configId) await verifyPublishingAccess(loginConfig, grant, profile.id, json);
      return reply(await saveAccount(states[0].user_id, grant, profile));
    }
    return reply({ error: "unknown_action" }, 400);
  } catch (e) {
    const safe = [
      "account_connection_disabled", "account_limit_reached",
      "app_not_found",
      "not_configured",
      "professional_required",
      "invalid_app_config",
      "invalid_token",
      "business_missing",
      "no_instagram_accounts",
      "multiple_instagram_accounts",
      "invalid_invite",
      "invalid_state",
      "invalid_selection",
      "meta_authorization_failed",
      "missing_permission",
      "account_already_connected",
      "provider_conflict",
    ];
    return reply(
      {
        error:
          e instanceof Error && safe.includes(e.message)
            ? e.message
            : "request_failed",
      },
      400,
    );
  }
});
