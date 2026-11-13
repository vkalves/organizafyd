type Result = { data: unknown; error: unknown };
type Query = PromiseLike<Result> & {
  eq: (column: string, value: string) => Query;
  order: (column: string, options?: { ascending: boolean }) => Query;
  range: (start: number, end: number) => Query;
  maybeSingle: () => PromiseLike<Result>;
};
type Database = {
  rpc: (name: string, args: Record<string, string>) => PromiseLike<Result>;
  from: (name: string) => { select: (columns: string) => Query };
};

export type SharedFlowProgress = {
  flow_id: string;
  flow_name: string;
  state: string;
  account_id: string;
  username: string;
  counts: Record<string, number>;
  next_at: string | null;
  recent: { id: string; status: string; format: string; scheduled_at: string; published_at: string | null }[];
};

function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new Error("database_error");
  return result.data;
}

// Service-role queries must be scoped to the authenticated participant, never a
// user/account/flow supplied in the request body. No media URLs or tokens leave here.
export async function readSharedFlowProgress(db: Database, userId: string): Promise<SharedFlowProgress[]> {
  const shares = checked(await db.rpc("ig_list_shared_flow_accounts", { p_user: userId })) as
    { flow_id: string; flow_name: string; account_id: string; username: string }[];
  const result: SharedFlowProgress[] = [];
  for (const share of shares) {
    const flow = checked(await db.from("ig_flows").select("state")
      .eq("id", share.flow_id).maybeSingle()) as { state: string } | null;
    if (!flow) continue;
    const counts: Record<string, number> = {};
    let nextAt: string | null = null;
    const recent: SharedFlowProgress["recent"] = [];
    for (let start = 0; ; start += 500) {
      const jobs = checked(await db.from("ig_publication_jobs")
        .select("id,status,format,scheduled_at,published_at")
        .eq("flow_id", share.flow_id).eq("account_id", share.account_id)
        .eq("shared_account_owner", userId)
        .order("scheduled_at", { ascending: false }).order("id")
        .range(start, start + 499)) as SharedFlowProgress["recent"] | null;
      if (!jobs) throw new Error("database_error");
      for (const job of jobs) {
        counts[job.status] = (counts[job.status] ?? 0) + 1;
        if (job.status === "scheduled" && (!nextAt || job.scheduled_at < nextAt)) nextAt = job.scheduled_at;
        if (recent.length < 20) recent.push(job);
      }
      if (jobs.length < 500) break;
    }
    // Recheck current membership so revocation during a long read removes access.
    const active = checked(await db.from("ig_flow_shared_accounts").select("account_id")
      .eq("flow_id", share.flow_id).eq("account_id", share.account_id)
      .eq("account_owner", userId).maybeSingle());
    if (active) result.push({ ...share, state: flow.state, counts, next_at: nextAt, recent });
  }
  return result;
}
