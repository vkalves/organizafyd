import { XError } from "./model.ts";
export const SCOPES =
  "tweet.read tweet.write users.read offline.access media.write";
export type Fetcher = typeof fetch;
export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
}
export async function tokens(
  fetcher: Fetcher,
  clientId: string,
  secret: string,
  params: URLSearchParams,
): Promise<Tokens> {
  const response = await fetcher("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${encodeURIComponent(clientId)}:${encodeURIComponent(secret)}`)}`,
    },
    body: params,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new XError(
      response.status === 400 || response.status === 401
        ? "reconnect_required"
        : "x_unavailable",
    );
  const data = await response.json();
  if (
    !data.access_token ||
    !data.refresh_token ||
    !Number.isFinite(data.expires_in)
  )
    throw new XError("reconnect_required");
  return data;
}
export async function xRequest(
  fetcher: Fetcher,
  token: string,
  path: string,
  init: RequestInit = {},
) {
  const response = await fetcher(`https://api.x.com/2${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    // Never forward upstream bodies, which can include private data.
    throw new XError(
      response.status === 401
        ? "reconnect_required"
        : response.status === 429
          ? "rate_limited"
          : response.status === 402
            ? "credits_required"
            : response.status === 403
              ? "permission_required"
              : response.status >= 500
                ? "x_unavailable"
                : "x_rejected",
      response.status,
    );
  }
  if (response.status === 204) return {};
  return response.json();
}
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
function encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export async function uploadMedia(
  fetcher: Fetcher,
  token: string,
  blob: Blob,
  deadline: number,
): Promise<string> {
  if (
    blob.size > (blob.type === "video/mp4" ? 20 : 5) * 1024 * 1024 ||
    !["image/jpeg", "image/png", "video/mp4"].includes(blob.type)
  )
    throw new XError("invalid_media");
  const category = blob.type === "video/mp4" ? "tweet_video" : "tweet_image";
  const initialized = await xRequest(
    fetcher,
    token,
    "/media/upload/initialize",
    json({
      total_bytes: blob.size,
      media_type: blob.type,
      media_category: category,
    }),
  );
  const id = initialized.data?.id;
  if (typeof id !== "string" || !/^\d+$/.test(id))
    throw new XError("media_failed");
  for (
    let offset = 0, segment = 0;
    offset < blob.size;
    offset += 4 * 1024 * 1024, segment++
  ) {
    if (Date.now() > deadline) throw new XError("media_timeout");
    await xRequest(
      fetcher,
      token,
      `/media/upload/${id}/append`,
      json({
        segment_index: segment,
        media: encode(
          new Uint8Array(
            await blob.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer(),
          ),
        ),
      }),
    );
  }
  let result = await xRequest(fetcher, token, `/media/upload/${id}/finalize`, {
    method: "POST",
  });
  while (
    result.data?.processing_info &&
    result.data.processing_info.state !== "succeeded"
  ) {
    if (result.data.processing_info.state === "failed")
      throw new XError("media_failed");
    const wait =
      Math.max(
        1,
        Math.min(10, result.data.processing_info.check_after_secs || 1),
      ) * 1000;
    if (Date.now() + wait + 20000 > deadline) throw new XError("media_timeout");
    await new Promise((resolve) => setTimeout(resolve, wait));
    result = await xRequest(fetcher, token, `/media/upload?media_id=${id}`);
  }
  return id;
}
export async function publish(
  fetcher: Fetcher,
  token: string,
  text: string,
  mediaIds: string[],
): Promise<string> {
  try {
    const result = await xRequest(
      fetcher,
      token,
      "/tweets",
      json({
        ...(text ? { text } : {}),
        ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}),
      }),
    );
    if (!/^\d+$/.test(result.data?.id ?? "")) throw new Error("missing id");
    return result.data.id;
  } catch (error) {
    // A timeout, malformed response or 5xx may happen AFTER X accepted the post.
    // Do not retry an ambiguous creation automatically.
    if (!(error instanceof XError) || error.status >= 500)
      throw new XError("confirmation_required");
    throw error;
  }
}
