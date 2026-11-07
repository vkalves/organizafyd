export type Profile = { id: string; username: string };
type Graph = (
  path: string,
  token: string,
  params?: Record<string, string>,
) => Promise<Record<string, unknown>>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function connectionInput(token: unknown, id?: unknown) {
  if (typeof token !== "string" || !token.trim() || token.trim().length > 4096)
    throw new Error("invalid_connection");
  if (id !== undefined && (typeof id !== "string" || !/^\d{5,30}$/.test(id)))
    throw new Error("invalid_instagram_id");
  return token.trim();
}
export async function checkProfile(
  graph: Graph,
  token: string,
  id: string,
): Promise<Profile> {
  connectionInput(token, id);
  const permissions = await graph("me/permissions", token);
  const granted = new Set(
    (Array.isArray(permissions.data) ? permissions.data : [])
      .filter((permission) => isRecord(permission) && permission.status === "granted")
      .map((permission) => isRecord(permission) ? permission.permission : null)
      .filter((permission): permission is string => typeof permission === "string"),
  );
  if (
    !granted.has("instagram_basic") ||
    !granted.has("instagram_content_publish")
  )
    throw new Error("missing_publish_permission");
  const profile = await graph(id, token, { fields: "id,username" });
  if (
    profile.id !== id ||
    typeof profile.username !== "string" ||
    !profile.username
  )
    throw new Error("invalid_instagram_id");
  // A read-only publishing endpoint verifies that this token can access this
  // professional account's publishing API. No test post is created.
  await graph(id + "/content_publishing_limit", token, {
    fields: "quota_usage",
  });
  return { id: profile.id, username: profile.username };
}
export async function discoverProfiles(
  graph: Graph,
  token: string,
): Promise<Profile[]> {
  const result = new Map<string, Profile>();
  let after: string | undefined;
  // Follow cursors on our fixed Graph host, never a token-bearing arbitrary URL.
  for (let page = 0; page < 10; page++) {
    const response = await graph("me/accounts", token, {
      fields: "instagram_business_account{id,username}",
      limit: "100",
      ...(after ? { after } : {}),
    });
    for (const item of Array.isArray(response.data) ? response.data : []) {
      if (!isRecord(item)) continue;
      const account = item.instagram_business_account;
      if (!isRecord(account)) continue;
      const id = account.id;
      const username = account.username;
      if (typeof id === "string" && typeof username === "string" && username)
        result.set(id, { id, username });
    }
    const paging = isRecord(response.paging) ? response.paging : undefined;
    const cursors = paging && isRecord(paging.cursors) ? paging.cursors : undefined;
    after = paging?.next && typeof cursors?.after === "string" ? cursors.after : undefined;
    if (!after) break;
  }
  return [...result.values()];
}
