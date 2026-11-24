import { classify, type HealthState, transition } from "./health.ts";

export type HealthRow = {
  account_id: string;
  user_id: string;
  state: HealthState;
  candidate: HealthState;
  failures: number;
  lease: string | null;
  checked_at: string | null;
  next_check_at: string;
};
export type CheckRepository = {
  connection: (
    accountId: string,
    userId: string,
  ) => Promise<
    { graph_id: string; secret_id: string; provider: string } | null
  >;
  token: (secretId: string) => Promise<string | null>;
  save: (row: HealthRow, update: Record<string, unknown>) => Promise<void>;
  syncAccount?: (
    accountId: string,
    userId: string,
    profile: { username: string },
  ) => Promise<void>;
};

export async function checkAccount(
  repo: CheckRepository,
  row: HealthRow,
  graph: typeof fetch = fetch,
) {
  const connection = await repo.connection(row.account_id, row.user_id);
  if (!connection) return;
  // Infrastructure failures must never be translated into a Meta account alert.
  const token = await repo.token(connection.secret_id);
  let result: HealthState = "reconnect";
  let errorCode: string | null = "credential_missing";
  let liveUsername: string | null = null;
  if (token) {
    try {
      const host = connection.provider === "instagram"
        ? "graph.instagram.com"
        : "graph.facebook.com";
      const url = new URL(
        `https://${host}/v24.0/${encodeURIComponent(connection.graph_id)}`,
      );
      url.searchParams.set("fields", "id,username");
      const response = await graph(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      const data = await response.json();
      const matchedIdentity =
        String(data.id ?? "") === connection.graph_id ||
        String(data.user_id ?? "") === connection.graph_id;
      if (response.ok && !data.error && !data.error_type && matchedIdentity) {
        result = "healthy";
        errorCode = null;
        if (
          typeof data.username === "string" &&
          /^[a-zA-Z0-9._]{1,30}$/.test(data.username)
        ) {
          liveUsername = data.username;
        }
        // Basic profile read does not prove content publishing permission was restored.
        if (row.state === "permissions") {
          try {
            const pubUrl = new URL(
              `https://${host}/v24.0/${encodeURIComponent(connection.graph_id)}/content_publishing_limit`,
            );
            pubUrl.searchParams.set("fields", "quota_usage");
            const pubRes = await graph(pubUrl, {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(8000),
            });
            const pubData = await pubRes.json();
            if (!pubRes.ok || pubData?.error || pubData?.error_type) {
              const pubCode = Number(pubData?.error?.code ?? pubData?.code) || undefined;
              const pubState = classify(
                pubCode,
                pubRes.status,
                pubData?.error?.is_transient === true,
              );
              if (pubState === "permissions" || pubState === "reconnect") {
                result = pubState;
                errorCode = `meta_${pubCode || pubRes.status}`;
              }
            }
          } catch {
            // Keep existing permissions alert on transient network failure during verification.
            result = "permissions";
            errorCode = "meta_200";
          }
        }
      } else if (response.ok && !data.error && !data.error_type) {
        result = "temporary";
        errorCode = "identity_mismatch";
      } else {
        const rawCode = Number(data.error?.code ?? data.code) || undefined;
        result = classify(
          rawCode,
          response.status,
          data.error?.is_transient === true,
        );
        errorCode = `meta_${rawCode || response.status}`;
      }
    } catch {
      result = "temporary";
      errorCode = "network_unavailable";
    }
  }
  const claimStart = row.next_check_at
    ? Date.parse(row.next_check_at) - 300_000
    : NaN;
  const nowMs = Number.isFinite(claimStart)
    ? Math.max(Date.now(), claimStart)
    : Date.now();
  const now = new Date(nowMs).toISOString();
  await repo.save(row, {
    ...transition(row, result),
    checked_at: now,
    error_code: errorCode,
    ...(result === "healthy" ? { last_healthy_at: now } : {}),
  });
  if (liveUsername && repo.syncAccount) {
    await repo.syncAccount(row.account_id, row.user_id, {
      username: liveUsername,
    }).catch(() => {});
  }
}
