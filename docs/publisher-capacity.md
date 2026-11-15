# Publication capacity and operational checks

All users share the same publishing infrastructure. This change distributes due
accounts across up to eight workers **per provider**, with four concurrent lanes
per worker. Database account leases and compare-and-set job updates remain the
source of truth for exclusivity.

## Scheduling

- `publisher_dispatch(platform)` counts due accounts once per minute. It starts
  one worker per 20 due accounts, capped at eight. An empty queue starts none.
- Accounts map to one of the current partitions using PostgreSQL's `hashtext`.
  Changing partition count is safe because claims still acquire account leases.
- Instagram workers perform at most 120 queue operations per request and stop
  acquiring work after 35 seconds. Already acquired operations finish normally.
  **960 operations is a scheduling ceiling, not 960 successful posts/minute.**
  Video processing polls also consume operations, and provider latency, database
  resources, rate limits and account publishing quotas determine actual capacity.
- X and TikTok select up to 120 accounts per partition and process four at a time,
  retaining their 90-second acquisition budget and existing provider safeguards.
- Instagram maintenance runs separately once a minute. A five-minute, token-owned
  lease prevents overlapping maintenance; release by a stale worker cannot remove
  another worker's lease. At most five campaign cycles are prepared per pass.
- Meta rate-limit responses back off the entire affected Instagram account,
  including its other campaigns. Other accounts continue processing.
- No worker resubmits an ambiguous accepted publication. Instagram reconciliation
  checks the existing container; TikTok retains its publish ID for polling.

## Database verification

Run `npm run test:capacity` with Docker available. It creates and removes an isolated
Postgres 17 container, uses synthetic accounts and stubs `pg_net`; no media is sent.
The test loads 1,000 accounts and 100,000 jobs, runs 32 concurrent database clients,
and checks exclusive account claims, disjoint partitions, backoff, maintenance
leases, access control, campaign gaps and pauses, and adaptive dispatch.

A local run after optimization acquired 160 jobs in approximately 4 seconds,
versus approximately 20 seconds before the query optimization, with zero duplicate
claims. These figures measure queue acquisition in the test environment, not
end-to-end publishing throughput or an SLA for production hardware.

The query first selects queue heads through an account/flow ordering index, then
applies campaign rules. It avoids evaluating costly campaign/media checks for
every queued video. Existing ordering, gap and account ownership rules remain.

## Deployment order

1. Apply `publisher_capacity` (compatible RPCs and indexes; legacy claims still work).
2. Deploy Instagram, X and TikTok functions, including `_shared/publisher-workers.ts`.
3. Apply `publisher_dispatch` to activate adaptive cron and separate maintenance.
4. Verify `net._http_response` for completed worker requests and inspect queue lag.

Worker responses and `publisher_tick` logs contain platform/partition/processed
counts and no credentials. Cron success means the HTTP request was enqueued, so
check the actual HTTP response too:

```sql
select id, status_code, timed_out, error_msg, created
from net._http_response
order by created desc limit 20;

select status, count(*), min(scheduled_at) as oldest_scheduled
from public.ig_publication_jobs group by status;

select count(*) as retrying_accounts
from public.ig_publisher_connections where publish_retry_at > now();
```

For sustained growth, monitor the age of the oldest **eligible** task, processing
latency, provider rate-limit responses and database CPU. Increase resources or
change the worker cap only after a representative load test and quota review.
The current bounded design handles more accounts without unbounded fan-out;
it cannot remove external provider permissions or rate limits.

## Captions and dashboard

Caption fallback ignores whitespace-only overrides. A missing caption in every
configured source is a content/configuration issue; the system does not invent
text for the user's publication. The dashboard uses a compact neutral
“Métricas parciais” disclosure inside the ranking panel. Account details and the
connection action appear only when expanded; available metrics remain visible.
