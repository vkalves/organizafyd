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
      const confirmingFailure =
        typeof update.candidate === "string" &&
        typeof update.state === "string" &&
        update.candidate !== update.state;
      const nextDelayMs = confirmingFailure ? 30_000 : 60_000;
      checked(
        await db.from("ig_account_health").update({
          ...update,
          lease: null,
          next_check_at: new Date(Date.now() + nextDelayMs).toISOString(),
        }).eq(
          "account_id",
          row.account_id,
        ).eq("user_id", row.user_id).eq("lease", row.lease),
      );
    },
    async syncAccount(accountId, userId, profile) {
      await db.from("instagram_accounts").update({
        username: profile.username,
      }).eq("id", accountId).eq("user_id", userId);
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
      let totalChecked = 0;
      let totalFailures = 0;
      for (let round = 0; round < 5; round++) {
        const rows: HealthRow[] =
          checked(await db.rpc("ig_claim_health_checks")) || [];
        if (!rows.length) break;
        let roundFailures = 0;
        for (let i = 0; i < rows.length; i += 10) {
          const results = await Promise.allSettled(
            rows.slice(i, i + 10).map((row) => checkAccount(checker, row, graph)),
          );
          roundFailures += results.filter((r) => r.status === "rejected").length;
        }
        totalChecked += rows.length - roundFailures;
        totalFailures += roundFailures;
        if (rows.length < 200) break;
      }
      return { checked: totalChecked, failures: totalFailures };
    },
    async status(userId) {
      // Active problems must not disappear behind a newer resolved-history limit.
      const [health, active, resolved, accountNames] = await Promise.all([
        pages<Record<string, unknown>>((from, to) =>
          db.from("ig_account_health").select(
            "account_id,state,candidate,failures,checked_at,last_healthy_at,error_code",
          ).eq("user_id", userId).order("account_id").range(from, to)
        ),
        pages<Record<string, unknown>>((from, to) =>
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
        pages<{ id: string; username: string }>((from, to) =>
          db.from("instagram_accounts").select("id,username").eq(
            "user_id",
            userId,
          ).order("id").range(from, to)
        ).catch(() => [] as { id: string; username: string }[]),
      ]);
      const usernameById = new Map(
        accountNames
          .filter((a) => typeof a.id === "string" && typeof a.username === "string")
          .map((a) => [a.id, a.username.replace(/^@/, "")]),
      );
      const withUsername = <T extends Record<string, unknown>>(item: T): T => {
        const accountId = typeof item.account_id === "string" ? item.account_id : "";
        const username = usernameById.get(accountId);
        return username ? { ...item, username } : item;
      };
      return {
        health: health.map(withUsername),
        alerts: [...active, ...((checked(resolved) || []) as Record<string, unknown>[])].map(
          withUsername,
        ),
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
      if (row.checked_at && now - Date.parse(row.checked_at) < 15_000) {
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
    async refreshAll(userId) {
      const connections = await pages<{ account_id: string }>((from, to) =>
        db.from("ig_publisher_connections").select("account_id").eq(
          "user_id",
          userId,
        ).order("account_id").range(from, to)
      );
      let checkedCount = 0;
      let skippedCount = 0;
      for (let i = 0; i < connections.length; i += 8) {
        const statuses = await Promise.all(
          connections.slice(i, i + 8).map((c) =>
            repository.refresh(userId, c.account_id).catch(() => "busy" as const)
          ),
        );
        for (const st of statuses) {
          if (st === "checked") checkedCount++;
          else skippedCount++;
        }
      }
      return { checked: checkedCount, skipped: skippedCount };
    },
  };
  return repository;
}
