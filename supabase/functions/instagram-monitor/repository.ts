import type { SupabaseClient } from "npm:@supabase/supabase-js@2.98.0";
import { checkAccount, type CheckRepository, type HealthRow } from "./check.ts";
import type { MonitorRepository } from "./handler.ts";

export function createMonitorRepository(
  db: SupabaseClient,
  graph: typeof fetch = fetch,
): MonitorRepository {
  function checked<T>({ data, error }: { data: T; error: unknown }): T {
    if (error) throw new Error("database_error");
    return data;
  }
  const checker: CheckRepository = {
    async connection(accountId, userId) {
      return checked(
        await db.from("ig_publisher_connections").select(
          "graph_id,secret_id,provider",
        ).eq("account_id", accountId).eq("user_id", userId).maybeSingle(),
      );
    },
    async token(secretId) {
      return checked(await db.rpc("ig_vault_read", { p_id: secretId }));
    },
    async save(row, update) {
      const saved = checked(
        await db.from("ig_account_health").update(update).eq(
          "account_id",
          row.account_id,
        ).eq("user_id", row.user_id).eq("lease", row.lease)
          .select("account_id"),
      );
      // A lost lease must never trigger a disconnect. Only a fresh,
      // confirmed unavailable result can reach the database guard.
      if (
        saved?.length === 1 &&
        update.state === "unavailable" &&
        update.candidate === "unavailable" &&
        Number(update.failures) >= 3 &&
        ["meta_100", "meta_803"].includes(String(update.error_code))
      ) {
        // Cleanup is best effort. A failed cleanup must not make the health
        // monitor forget its successfully recorded diagnosis.
        const cleanup = await db.rpc("ig_auto_remove_unavailable_account", {
          p_user: row.user_id,
          p_account: row.account_id,
          p_lease: row.lease,
        });
        if (cleanup.error) {
          console.error("instagram_account_cleanup_failed", {
            account_id: row.account_id,
            code: cleanup.error.code,
          });
        }
      }
    },
  };
  async function pages<T>(
    read: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: T[] | null; error: unknown }>,
  ): Promise<T[]> {
    const result: T[] = [];
    for (let from = 0;; from += 500) {
      const batch = checked(await read(from, from + 499)) || [];
      result.push(...batch);
      if (batch.length < 500) return result;
    }
  }
  const repository: MonitorRepository = {
    async authenticate(jwt) {
      const { data, error } = await db.auth.getUser(jwt);
      return error ? null : data.user?.id || null;
    },
    async workerKey() {
      return checked(await db.rpc("ig_worker_key"));
    },
    async worker() {
      const rows: HealthRow[] = checked(await db.rpc("ig_claim_health_checks"));
      let failures = 0;
      for (let i = 0; i < rows.length; i += 5) {
        const results = await Promise.allSettled(
          rows.slice(i, i + 5).map((row) => checkAccount(checker, row, graph)),
        );
        failures += results.filter((r) => r.status === "rejected").length;
      }
      return { checked: rows.length - failures, failures };
    },
    async status(userId) {
      // Active problems must not disappear behind a newer resolved-history limit.
      const [health, active, resolved] = await Promise.all([
        pages((from, to) =>
          db.from("ig_account_health").select(
            "account_id,state,candidate,failures,checked_at,last_healthy_at,error_code",
          ).eq("user_id", userId).order("account_id").range(from, to)
        ),
        pages((from, to) =>
          db.from("ig_account_alerts").select(
            "id,account_id,state,created_at,read_at,resolved_at",
          ).eq("user_id", userId).is("resolved_at", null).order("created_at", {
            ascending: false,
          }).order("id").range(from, to)
        ),
        db.from("ig_account_alerts").select(
          "id,account_id,state,created_at,read_at,resolved_at",
        ).eq("user_id", userId).not("resolved_at", "is", null).order(
          "created_at",
          { ascending: false },
        ).order("id").limit(100),
      ]);
      return {
        health,
        alerts: [...active, ...(checked(resolved) || [])],
        history_limit: 100,
      };
    },
    async read(userId, id) {
      let query = db.from("ig_account_alerts").update({
        read_at: new Date().toISOString(),
      }, { count: "exact" }).eq("user_id", userId).is("read_at", null).is(
        "resolved_at",
        null,
      );
      if (id) query = query.eq("id", id);
      const result = await query;
      checked(result);
      return result.count || 0;
    },
    async refresh(userId, accountId) {
      const connection = await checker.connection(accountId, userId);
      if (!connection) return "not_found";
      // Initialise new connections without waiting for the next cron tick.
      checked(
        await db.from("ig_account_health").upsert({
          account_id: accountId,
          user_id: userId,
        }, { onConflict: "account_id", ignoreDuplicates: true }),
      );
      const row: HealthRow | null = checked(
        await db.from("ig_account_health").select("*").eq(
          "account_id",
          accountId,
        ).eq("user_id", userId).maybeSingle(),
      );
      if (!row) return "not_found";
      const now = Date.now();
      if (row.checked_at && now - Date.parse(row.checked_at) < 60_000) {
        return "recent";
      }
      // A claim whose check has not finished belongs to a running worker.
      const claimTime = Date.parse(row.next_check_at) - 300_000;
      if (
        row.lease && Date.parse(row.next_check_at) > now &&
        (!row.checked_at || Date.parse(row.checked_at) < claimTime)
      ) return "busy";
      let query = db.from("ig_account_health").update({
        lease: crypto.randomUUID(),
        next_check_at: new Date(now + 300_000).toISOString(),
      }).eq("account_id", accountId).eq("user_id", userId).eq(
        "next_check_at",
        row.next_check_at,
      );
      query = row.lease
        ? query.eq("lease", row.lease)
        : query.is("lease", null);
      const claimed = checked(await query.select("*").maybeSingle()) as
        | HealthRow
        | null;
      if (!claimed) return "busy";
      await checkAccount(checker, claimed, graph);
      return "checked";
    },
  };
  return repository;
}
