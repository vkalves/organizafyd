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
      if (
        response.ok && !data.error && String(data.id) === connection.graph_id
      ) {
        result = "healthy";
        errorCode = null;
      } else if (response.ok && !data.error) {
        result = "temporary";
        errorCode = "identity_mismatch";
      } else {
        result = classify(
          Number(data.error?.code) || undefined,
          response.status,
          data.error?.is_transient === true,
        );
        errorCode = `meta_${Number(data.error?.code) || response.status}`;
      }
    } catch {
      result = "temporary";
      errorCode = "network_unavailable";
    }
  }
  const now = new Date().toISOString();
  await repo.save(row, {
    ...transition(row, result),
    checked_at: now,
    error_code: errorCode,
    ...(result === "healthy" ? { last_healthy_at: now } : {}),
  });
}
