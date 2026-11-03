export type Config = { appId: string; secret: string; configId: string };
export function authorizeUrl(config: Config, callback: string, state: string) {
  const url = new URL("https://www.facebook.com/v24.0/dialog/oauth");
  url.search = new URLSearchParams({
    client_id: config.appId,
    config_id: config.configId,
    redirect_uri: callback,
    response_type: "code",
    override_default_response_type: "true",
    prompt: "login",
    state,
  }).toString();
  return url.toString();
}
type Json = (url: string, init?: RequestInit) => Promise<any>;
export async function authorizedAccount(
  config: Config,
  callback: string,
  code: string,
  json: Json,
) {
  const response = await json(
    "https://graph.facebook.com/v24.0/oauth/access_token?" +
      new URLSearchParams({
        client_id: config.appId,
        client_secret: config.secret,
        redirect_uri: callback,
        code,
      }),
  );
  const token = response.access_token;
  if (typeof token !== "string" || !token)
    throw new Error("meta_authorization_failed");
  const debug = await json(
    "https://graph.facebook.com/v24.0/debug_token?" +
      new URLSearchParams({
        input_token: token,
        access_token: config.appId + "|" + config.secret,
      }),
  );
  const data = debug.data;
  if (
    !data?.is_valid ||
    String(data.app_id) !== config.appId ||
    data.type !== "SYSTEM_USER"
  )
    throw new Error("invalid_token");
  if (
    !["instagram_basic", "instagram_content_publish"].every((p) =>
      data.scopes?.includes(p),
    )
  )
    throw new Error("missing_permission");
  if (data.expires_at && data.expires_at * 1000 <= Date.now())
    throw new Error("invalid_token");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(config.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const proof = Array.from(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  const read = (path: string, fields: string) =>
    json(
      "https://graph.facebook.com/v24.0/" +
        path +
        "?" +
        new URLSearchParams({ fields, appsecret_proof: proof }),
      { headers: { Authorization: "Bearer " + token } },
    );
  const business = await read("me", "client_business_id");
  if (!business.client_business_id) throw new Error("business_missing");
  const accounts = await read("me/assigned_instagram_accounts", "id,username");
  if (!accounts.data?.length) throw new Error("no_instagram_accounts");
  if (accounts.data.length !== 1 || accounts.paging?.next)
    throw new Error("multiple_instagram_accounts");
  const profile = accounts.data[0];
  if (
    !/^\d{5,30}$/.test(String(profile.id)) ||
    typeof profile.username !== "string" ||
    !profile.username
  )
    throw new Error("meta_authorization_failed");
  await read(profile.id + "/content_publishing_limit", "quota_usage");
  return {
    token,
    id: String(profile.id),
    username: profile.username,
    businessId: String(business.client_business_id),
    expiresAt: data.expires_at
      ? new Date(data.expires_at * 1000).toISOString()
      : null,
  };
}
