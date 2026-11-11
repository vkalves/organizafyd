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
export async function authorizedAccounts(
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
  const read = await graphReader(config, token, json);
  const business = await read("me", "client_business_id");
  if (!business.client_business_id) throw new Error("business_missing");
  const profiles = new Map<string, Profile>();
  const cursors = new Set<string>();
  let after = "";
  for (let page = 0; page < 10; page++) {
    const accounts = await read("me/assigned_instagram_accounts", "id,username", { limit: "100", ...(after ? { after } : {}) });
    if (!Array.isArray(accounts.data)) throw new Error("meta_authorization_failed");
    for (const profile of accounts.data) {
      if (!/^\d{5,30}$/.test(String(profile.id)) || typeof profile.username !== "string" || !/^[a-zA-Z0-9._]{1,30}$/.test(profile.username)) throw new Error("meta_authorization_failed");
      profiles.set(String(profile.id), { id: String(profile.id), username: profile.username });
    }
    if (profiles.size > 500) throw new Error("meta_authorization_failed");
    if (!accounts.paging?.next) break;
    const cursor = accounts.paging?.cursors?.after;
    if (page === 9 || typeof cursor !== "string" || !cursor || cursor.length > 2000 || cursors.has(cursor)) throw new Error("meta_authorization_failed");
    cursors.add(cursor);
    after = cursor;
  }
  if (!profiles.size) throw new Error("no_instagram_accounts");
  return {
    token,
    accounts: [...profiles.values()],
    businessId: String(business.client_business_id),
    expiresAt: data.expires_at ? new Date(data.expires_at * 1000).toISOString() : null,
  };
}
export type Profile = { id: string; username: string };
export type Grant = { metaAppId?: string; metaAppClientId?: string; metaAppConfigId?: string; provider?: "facebook" | "instagram"; token: string; accounts: Profile[]; businessId: string; expiresAt: string | null };
async function graphReader(config: Config, token: string, json: Json) {
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
  const read = (path: string, fields: string, extra: Record<string, string> = {}) =>
    json(
      "https://graph.facebook.com/v24.0/" +
        path +
        "?" +
        new URLSearchParams({ ...extra, fields, appsecret_proof: proof }),
      { headers: { Authorization: "Bearer " + token } },
    );
  return read;
}
export async function verifyPublishingAccess(config: Config, grant: Grant, accountId: string, json: Json) {
  if (!grant.accounts.some(a => a.id === accountId)) throw new Error("invalid_selection");
  const read = await graphReader(config, grant.token, json);
  await read(accountId + "/content_publishing_limit", "quota_usage");
}
// Strict compatibility helper for callers that have not implemented profile selection.
export async function authorizedAccount(config: Config, callback: string, code: string, json: Json) {
  const grant = await authorizedAccounts(config, callback, code, json);
  if (grant.accounts.length !== 1) throw new Error("multiple_instagram_accounts");
  const profile = grant.accounts[0];
  await verifyPublishingAccess(config, grant, profile.id, json);
  return { token: grant.token, ...profile, businessId: grant.businessId, expiresAt: grant.expiresAt };
}
