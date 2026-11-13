import { requireApprovedAccount } from "../_shared/account-approval.ts";
import { connectionSiteOrigin, integrationOrigins } from "../_shared/integration-origins.ts";
import { instagramAuthorizeUrl, instagramGrant } from "./instagram.ts";
import { selectConnectionApp } from "./connection-option.ts";
import { upgradeLegacySelection, type LegacySelectionStore } from "./legacy-selection.ts";
import { assertExpectedIdentity, completedResult, digest, expectedIdentity, hex, openGrant, publicRecovery, sealGrant, type RecoveryRow } from "./recovery.ts";
import { authorizeUrl, authorizedAccounts, verifyPublishingAccess, type Grant, type Profile } from "./unified.ts";
import { createClient } from "npm:@supabase/supabase-js@2.98.0";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
requireApprovedAccount(db);
const site = connectionSiteOrigin(Deno.env.get("AVANCA_SITE_ORIGIN"));
const allowedOrigins = integrationOrigins(Deno.env.get("AVANCA_EXTRA_ORIGINS"), site);
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
const recoveryColumns = "state_hash,verifier_hash,user_id,meta_app_id,expires_at,pending_grant,expected_username,expected_graph_id,operation_status,operation_updated_at,operation_result,selection_hash,selected_graph_id";
const legacySelectionStore: LegacySelectionStore = {
  async findLegacy(hash, proof, now) {
    return checked(await db.from("ig_login_states").select(recoveryColumns)
      .eq("state_hash", hash).eq("verifier_hash", proof).eq("operation_status", "pending")
      .is("selection_hash", null).not("pending_grant", "is", null).gt("expires_at", now).maybeSingle());
  },
  async upgrade(previous, next) {
    // Compare ciphertext inside PostgreSQL: a large grant must not become a URL filter.
    const rows = checked(await db.rpc("ig_upgrade_legacy_selection", {
      p_state: previous.state_hash, p_proof: previous.verifier_hash,
      p_previous_grant: previous.pending_grant, p_pending_grant: next.pending_grant,
      p_app: next.meta_app_id, p_result: next.operation_result,
    })) as RecoveryRow[];
    return rows.length === 1 ? rows[0] : null;
  },
  async findCurrent(hash, proof, now) {
    return checked(await db.from("ig_login_states").select(recoveryColumns)
      .eq("selection_hash", hash).eq("verifier_hash", proof).gt("expires_at", now).maybeSingle());
  },
};
async function recoveryRow(state: unknown, selection: unknown, verifier: unknown): Promise<RecoveryRow> {
  if(typeof verifier!=="string"||!/^[a-f0-9]{64}$/.test(verifier))throw new Error("invalid_state");
  const isSelection=typeof selection==="string"&&/^[a-f0-9]{64}$/.test(selection);
  if(!isSelection&&(typeof state!=="string"||state.length<1||state.length>100))throw new Error("invalid_state");
  const value=isSelection?await digest("selection:"+selection):await digest(state as string);
  let row=checked(await db.from("ig_login_states").select(recoveryColumns)
    .eq(isSelection?"selection_hash":"state_hash",value).eq("verifier_hash",await digest(verifier))
    .gt("expires_at",new Date().toISOString()).maybeSingle()) as RecoveryRow|null;
  if (!row && isSelection) row = await upgradeLegacySelection(selection as string, verifier,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, legacySelectionStore);
  if(!row)throw new Error(isSelection?"invalid_selection":"invalid_state");
  return row;
}
async function claim(row: RecoveryRow, from: "pending"|"selection_required", selected: string|null=null) {
  const rows=checked(await db.from("ig_login_states").update({operation_status:"processing",operation_updated_at:new Date().toISOString(),selected_graph_id:selected})
    .eq("state_hash",row.state_hash).eq("verifier_hash",row.verifier_hash).eq("operation_status",from)
    .gt("expires_at",new Date().toISOString()).select(recoveryColumns)) as RecoveryRow[];
  if(rows.length!==1)throw new Error("operation_in_progress");
  return rows[0];
}
async function restart(row: RecoveryRow) {
  // An authorization code may already have been exchanged. Never replay it blindly.
  checked(await db.from("ig_login_states").update({operation_status:"restart_required",operation_updated_at:new Date().toISOString(),pending_grant:null})
    .eq("state_hash",row.state_hash).eq("verifier_hash",row.verifier_hash).eq("operation_status","processing"));
}
async function saveAccount(row: RecoveryRow, grant: Grant, profile: Profile) {
  assertExpectedIdentity(row,profile);
  const result=await db.rpc("ig_complete_login",{
    p_state:row.state_hash,p_proof:row.verifier_hash,p_graph:profile.id,p_username:profile.username,
    p_token:grant.token,p_business:grant.businessId||null,p_expires:grant.expiresAt,
    p_app_client_id:grant.metaAppClientId||null,p_config_id:grant.metaAppConfigId||null,
  });
  if(result.error) {
    const safe=["account_mismatch","account_already_connected","provider_conflict","app_not_found","account_connection_disabled","account_limit_reached","invalid_state","account_not_approved"];
    throw new Error(safe.includes(result.error.message)?result.error.message:"database_error");
  }
  return result.data;
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
      if (action === "save" && (typeof b.configId !== "string" || !/^[0-9]{5,40}$/.test(b.configId.trim()))) {
        return reply({ error: "invalid_config_id" }, 400);
      }
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
      const usePlatform = b.app_id === null || (!b.app_id && !apps.some((app: { active: boolean }) => app.active));
      const platformReady = usePlatform && await platformConnectionReady();
      const app = selectConnectionApp<{ id: string; active: boolean }>(apps, b.app_id, platformReady);
      const token = random();
      const expected=expectedIdentity(b.expected_username,b.expected_graph_id);
      checked(await db.rpc("ig_prune_login_records"));
      // Independent links must not invalidate another in-progress authorization.
      checked(
        await db.from("ig_connection_invites").insert({
          token_hash: await hash(token),
          ...expected,
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
          .select("user_id,manager_label,meta_app_id,expected_username,expected_graph_id")
          .eq("token_hash", await hash(b.invite))
          .gt("expires_at", new Date().toISOString())
          .maybeSingle(),
      );
      if (!invite) throw new Error("invalid_invite");
      const loginConfig = await loginConfigFor(invite.user_id, invite.meta_app_id);
      if (b.action === "invite_info")
        return reply({ manager: invite.manager_label, provider: loginConfig.configId ? "facebook" : "instagram", expected_username: invite.expected_username || undefined });
      if (typeof b.verifier !== "string" || !/^[a-f0-9]{64}$/.test(b.verifier))
        throw new Error("invalid_state");
      const state = random();
      // Consume the invite and insert the state in the same database transaction.
      const started=await db.rpc("ig_begin_login",{p_invite:await hash(b.invite),p_state:await hash(state),p_proof:await hash(b.verifier)});
      if(started.error)throw new Error(started.error.message==="invalid_invite"?"invalid_invite":"database_error");
      return reply({ url: (loginConfig.configId ? authorizeUrl : instagramAuthorizeUrl)(loginConfig, callback, state), state });
    }
    if(b.action==="recovery_status") {
      let row=await recoveryRow(b.state,b.selection,b.verifier);
      if(row.operation_status==="processing"&&Date.parse(row.operation_updated_at)<Date.now()-90_000) {
        // A stalled one-use exchange cannot safely be restarted. A completed save
        // is atomic with the completion record, so this never overwrites success.
        await restart(row);
        row=await recoveryRow(b.state,b.selection,b.verifier);
      }
      return reply(publicRecovery(row));
    }
    if(b.action==="select_account") {
      let row=await recoveryRow(undefined,b.selection,b.verifier);
      if(typeof b.account_id!=="string"||!/^\d{5,30}$/.test(b.account_id))throw new Error("invalid_selection");
      const done=completedResult(row,b.account_id);
      if(done)return reply(done);
      if(row.operation_status!=="selection_required")throw new Error(row.operation_status==="processing"?"operation_in_progress":"authorization_restart_required");
      const grant=await openGrant(row,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const profile=grant.accounts.find(a=>a.id===b.account_id);
      if(!profile)throw new Error("invalid_selection");
      assertExpectedIdentity(row,profile);
      row=await claim(row,"selection_required",profile.id);
      try {
        const loginConfig=await loginConfigFor(row.user_id,row.meta_app_id);
        await verifyPublishingAccess(loginConfig,grant,profile.id,json);
        return reply(await saveAccount(row,grant,profile));
      } catch(error) { await restart(row); throw error; }
    }
    if(b.action==="finish") {
      let row=await recoveryRow(b.state,undefined,b.verifier);
      const done=completedResult(row);
      if(done)return reply(done);
      if(row.operation_status==="selection_required")return reply(publicRecovery(row).result);
      if(row.operation_status!=="pending")throw new Error(row.operation_status==="processing"?"operation_in_progress":"authorization_restart_required");
      if(typeof b.code!=="string"||b.code.length<1||b.code.length>4096)throw new Error("invalid_state");
      row=await claim(row,"pending");
      try {
        const loginConfig=await loginConfigFor(row.user_id,row.meta_app_id);
        const grant: Grant=loginConfig.configId
          ?await authorizedAccounts(loginConfig,callback,b.code,json)
          :await instagramGrant(loginConfig,callback,b.code,json);
        if(row.meta_app_id) {
          grant.metaAppId=row.meta_app_id;grant.metaAppClientId=loginConfig.appId;grant.metaAppConfigId=loginConfig.configId;
        }
        const candidates=grant.accounts.filter(profile=>{
          try{assertExpectedIdentity(row,profile);return true;}catch{return false;}
        });
        if(!candidates.length)throw new Error("account_mismatch");
        grant.accounts=candidates;
        row.pending_grant=await sealGrant(grant,row,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        if(candidates.length>1) {
          if(b.allow_selection!==true)throw new Error("multiple_instagram_accounts");
          const nonce=hex(crypto.getRandomValues(new Uint8Array(32)));
          const result={selection:nonce,accounts:candidates.map(({id,username})=>({id,username}))};
          const rows=checked(await db.from("ig_login_states").update({pending_grant:row.pending_grant,operation_status:"selection_required",operation_result:result,selection_hash:await digest("selection:"+nonce),operation_updated_at:new Date().toISOString()})
            .eq("state_hash",row.state_hash).eq("verifier_hash",row.verifier_hash).eq("operation_status","processing").select("state_hash"));
          if(rows.length!==1)throw new Error("authorization_restart_required");
          return reply(result);
        }
        const savedGrant=checked(await db.from("ig_login_states").update({pending_grant:row.pending_grant,selected_graph_id:candidates[0].id,operation_updated_at:new Date().toISOString()})
          .eq("state_hash",row.state_hash).eq("verifier_hash",row.verifier_hash).eq("operation_status","processing").select("state_hash"));
        if(savedGrant.length!==1)throw new Error("authorization_restart_required");
        if(loginConfig.configId)await verifyPublishingAccess(loginConfig,grant,candidates[0].id,json);
        return reply(await saveAccount(row,grant,candidates[0]));
      }catch(error){await restart(row);throw error;}
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
      "account_mismatch", "invalid_expected_account", "operation_in_progress", "authorization_restart_required", "account_not_approved",
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
