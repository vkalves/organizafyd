import { createClient } from "npm:@supabase/supabase-js@2.98.0";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const site = "https://www.organizafy.site";
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
async function json(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error("meta_authorization_failed");
  return d;
}
Deno.serve(async (req) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": site,
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
    const config = checked(await db.rpc("ig_login_config")) || {};
    const appId = Deno.env.get("INSTAGRAM_APP_ID") || config.instagram_app_id;
    const secret =
      Deno.env.get("INSTAGRAM_APP_SECRET") || config.instagram_app_secret;
    if (b.action === "config")
      return reply({ ready: !!(appId && secret), callback });
    if (!appId || !secret) return reply({ error: "not_configured" }, 503);
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
        await db
          .from("ig_connection_invites")
          .insert({
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
        await db
          .from("ig_login_states")
          .insert({
            state_hash: await hash(state),
            verifier_hash: await hash(b.verifier),
            user_id: invite.user_id,
          }),
      );
      const url = new URL("https://www.instagram.com/oauth/authorize");
      url.search = new URLSearchParams({
        client_id: appId,
        redirect_uri: callback,
        response_type: "code",
        scope: "instagram_business_basic,instagram_business_content_publish",
        state,
      }).toString();
      return reply({ url: url.toString(), state });
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
      const tokenResponse = await json(
        "https://api.instagram.com/oauth/access_token",
        {
          method: "POST",
          body: new URLSearchParams({
            client_id: appId,
            client_secret: secret,
            grant_type: "authorization_code",
            redirect_uri: callback,
            code: b.code,
          }),
        },
      );
      const short = tokenResponse.access_token
        ? tokenResponse
        : tokenResponse.data?.length === 1
          ? tokenResponse.data[0]
          : null;
      if (!short?.access_token) throw new Error("meta_authorization_failed");
      const long = await json(
        "https://graph.instagram.com/access_token?" +
          new URLSearchParams({
            grant_type: "ig_exchange_token",
            client_secret: secret,
            access_token: short.access_token,
          }),
      );
      if (
        !long.access_token ||
        !Number.isFinite(long.expires_in) ||
        long.expires_in <= 0
      )
        throw new Error("meta_authorization_failed");
      const auth = { Authorization: "Bearer " + long.access_token };
      const profile = await json(
        "https://graph.instagram.com/v24.0/me?fields=user_id,username",
        { headers: auth },
      );
      const id = String(profile.user_id || profile.id || "");
      if (!/^\d{5,30}$/.test(id) || !profile.username)
        throw new Error("meta_authorization_failed");
      const permissions = await json(
        "https://graph.instagram.com/v24.0/me/permissions",
        { headers: auth },
      );
      const granted = new Set(
        (permissions.data || [])
          .filter((p: any) => p.status === "granted")
          .map((p: any) => p.permission),
      );
      if (
        !granted.has("instagram_business_basic") ||
        !granted.has("instagram_business_content_publish")
      )
        throw new Error("missing_permission");
      const saved = await db.rpc("ig_connect_oauth", {
        p_user: states[0].user_id,
        p_graph: id,
        p_username: profile.username,
        p_token: long.access_token,
        p_expires: new Date(Date.now() + long.expires_in * 1000).toISOString(),
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
      return reply({ username: profile.username });
    }
    return reply({ error: "unknown_action" }, 400);
  } catch (e) {
    const safe = [
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
