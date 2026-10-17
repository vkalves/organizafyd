import { TikTokError } from "./model.ts";
export const SCOPES = "video.publish";
export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  open_id: string;
  scope: string;
}
export async function tokens(
  fetcher: typeof fetch,
  key: string,
  secret: string,
  params: URLSearchParams,
): Promise<Tokens> {
  params.set("client_key", key);
  params.set("client_secret", secret);
  const res = await fetcher("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (
    !res.ok ||
    data.error ||
    !data.access_token ||
    !data.refresh_token ||
    !data.open_id ||
    !Number.isFinite(data.expires_in)
  )
    throw new TikTokError("reconnect_required", 401);
  return data;
}
export async function tiktok(
  fetcher: typeof fetch,
  token: string,
  path: string,
  body: unknown,
) {
  const response = await fetcher("https://open.tiktokapis.com/v2" + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || result.error?.code !== "ok") {
    const code = result.error?.code;
    if (code === "access_token_invalid" || code === "scope_not_authorized")
      throw new TikTokError("reconnect_required", 401);
    // A 5xx response to initialization may have accepted the publication.
    if (response.status >= 500 || code === "internal_error") throw new Error("tiktok_unavailable");
    throw new TikTokError(
      typeof code === "string" && /^[a-z_]{1,100}$/.test(code)
        ? code
        : "tiktok_unavailable",
    );
  }
  if (!result.data) throw new Error("invalid_tiktok_response");
  return result.data;
}
