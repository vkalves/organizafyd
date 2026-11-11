import type { Config, Grant } from "./unified.ts";
export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_insights"];
export function instagramAuthorizeUrl(config: Pick<Config, "appId">, callback: string, state: string) {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.search = new URLSearchParams({ client_id: config.appId, redirect_uri: callback,
    response_type: "code", scope: INSTAGRAM_SCOPES.join(","), state,
    enable_fb_login: "0", force_reauth: "true" }).toString();
  return url.toString();
}
type Json = (url: string, init?: RequestInit) => Promise<any>;
export async function instagramGrant(config: Pick<Config, "appId" | "secret">, callback: string, code: string, json: Json): Promise<Grant> {
  const response = await json("https://api.instagram.com/oauth/access_token", {
    method: "POST", body: new URLSearchParams({ client_id: config.appId, client_secret: config.secret,
      grant_type: "authorization_code", redirect_uri: callback, code }),
  });
  const short = Array.isArray(response.data) ? response.data[0] : response;
  if (!short || typeof short.access_token !== "string" || !short.access_token) throw new Error("meta_authorization_failed");
  // Some Meta responses include permissions. Always require the two publishing scopes when supplied.
  const permissions = typeof short.permissions === "string" ? short.permissions.split(",").map((s: string) => s.trim()) : short.permissions;
  if (Array.isArray(permissions) && !INSTAGRAM_SCOPES.slice(0, 2).every(p => permissions.includes(p))) throw new Error("missing_permission");
  const long = await json("https://graph.instagram.com/access_token?" + new URLSearchParams({
    grant_type: "ig_exchange_token", client_secret: config.secret, access_token: short.access_token,
  }));
  if (typeof long.access_token !== "string" || !long.access_token || !Number.isFinite(long.expires_in) || long.expires_in <= 0) throw new Error("meta_authorization_failed");
  const profile = await json("https://graph.instagram.com/v24.0/me?fields=user_id,username,account_type", {
    headers: { Authorization: "Bearer " + long.access_token },
  });
  const id = String(profile.user_id || profile.id || "");
  if (!/^\d{5,30}$/.test(id) || typeof profile.username !== "string" || !/^[a-zA-Z0-9._]{1,30}$/.test(profile.username)) throw new Error("no_instagram_accounts");
  if (profile.account_type && !["BUSINESS", "MEDIA_CREATOR"].includes(profile.account_type)) throw new Error("professional_required");
  await json(`https://graph.instagram.com/v24.0/${id}/content_publishing_limit?fields=quota_usage`, {
    headers: { Authorization: "Bearer " + long.access_token },
  });
  return { token: long.access_token, accounts: [{ id, username: profile.username }], businessId: "",
    expiresAt: new Date(Date.now() + long.expires_in * 1000).toISOString(), provider: "instagram" };
}
