import { authorizeUrl, authorizedAccount } from "./unified.ts";
import { createClient } from "npm:@supabase/supabase-js@2.98.0";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const site = "https://www.organizafy.site";
const allowedOrigins = new Set([site, "https://organizafy.site", "https://organizafyd.vercel.app"]);
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
function checked({ data, error }: { data: unknown; error: unknown }) {
  if (error) throw new Error("database_error");
  return data;
}
async function json(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  const value: unknown = await r.json();
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("meta_authorization_failed");
  const d = value as Record<string, unknown>;
  if (!r.ok || d.error) throw new Error("meta_authorization_failed");
  return d;
}
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
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error("invalid_request");
    const b = parsed as Record<string, unknown>;
    const configData = checked(await db.rpc("ig_login_config"));
    const config =
      typeof configData === "object" && configData !== null && !Array.isArray(configData)
        ? configData as Record<string, unknown>
        : {};
    const appId = config.meta_app_id;
    const secret = config.meta_app_secret;
    const configId = config.meta_config_id;
    const ready = typeof appId === "string" && typeof secret === "string" && typeof configId === "string";
    if (b.action === "config") return reply({ ready, callback });
    if (!ready) return reply({ error: "not_configured" }, 503);
    if (typeof appId !== "string" || typeof secret !== "string" || typeof configId !== "string")
      return reply({ error: "not_configured" }, 503);
    const loginConfig = { appId, secret, configId };
    if (b.action === "invite") {
      const jwt =
        req.headers.get("authorization")?.replace(/^Bearer /i, "") || "";
      const {
        data: { user },
        error,
      } = await db.auth.getUser(jwt);
      if (error || !user) return reply({ error: "unauthorized" }, 401);
      const token = random();
      checked(
        await db.from("ig_connection_invites").delete().eq("user_id", user.id),
      );
      checked(
        await db.from("ig_connection_invites").insert({
          token_hash: await hash(token),
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
          .select("user_id,manager_label")
          .eq("token_hash", await hash(b.invite))
          .gt("expires_at", new Date().toISOString())
          .maybeSingle(),
      );
      if (!invite) throw new Error("invalid_invite");
      if (b.action === "invite_info")
        return reply({ manager: invite.manager_label });
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
          verifier_hash: await hash(b.verifier),
          user_id: invite.user_id,
        }),
      );
      return reply({ url: authorizeUrl(loginConfig, callback, state), state });
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
          .eq("verifier_hash", await hash(b.verifier))
          .gt("expires_at", new Date().toISOString())
          .select("user_id"),
      );
      if (states.length !== 1) throw new Error("invalid_state");
      const account = await authorizedAccount(
        loginConfig,
        callback,
        b.code,
        json,
      );
      const saved = await db.rpc("ig_connect_unified", {
        p_user: states[0].user_id,
        p_graph: account.id,
        p_username: account.username,
        p_token: account.token,
        p_business: account.businessId,
        p_expires: account.expiresAt,
      });
      if (saved.error) {
        if (
          ["account_already_connected", "provider_conflict"].includes(
            saved.error.message,
          )
        )
          throw new Error(saved.error.message);
        throw new Error("database_error");
      }
      return reply({ username: account.username });
    }
    return reply({ error: "unknown_action" }, 400);
  } catch (e) {
    const safe = [
      "invalid_token",
      "business_missing",
      "no_instagram_accounts",
      "multiple_instagram_accounts",
      "invalid_invite",
      "invalid_state",
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
