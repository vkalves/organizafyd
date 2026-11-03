export type Profile = { id: string; username: string };
type Graph = (
  path: string,
  token: string,
  params?: Record<string, string>,
) => Promise<any>;
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
    (permissions.data ?? [])
      .filter((p: { status: string }) => p.status === "granted")
      .map((p: { permission: string }) => p.permission),
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
    for (const item of response.data ?? []) {
      const p = item.instagram_business_account;
      if (p?.id && p?.username)
        result.set(p.id, { id: p.id, username: p.username });
    }
    after = response.paging?.next ? response.paging?.cursors?.after : undefined;
    if (!after) break;
  }
  return [...result.values()];
}
