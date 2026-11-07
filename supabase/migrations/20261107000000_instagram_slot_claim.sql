begin;

-- Fixed-slot flows use a three-minute safety floor plus batch rest.
-- GAP flows keep their configured interval. Legacy flows without schedule
-- continue to be treated as GAP flows.
create or replace function public.ig_claim_job(p_token uuid)
returns setof public.ig_publication_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ig_publication_jobs
  set status = 'uncertain',
      error_code = 'worker_interrupted'
  where status = 'processing'
    and locked_at < now() - interval '10 minutes';

  return query
  update public.ig_publication_jobs j
  set status = 'processing',
      lock_token = p_token,
      locked_at = now(),
      attempts = j.attempts + 1
  where j.id = (
    select q.id
    from public.ig_publication_jobs q
    join public.ig_publisher_connections c on c.account_id = q.account_id
    left join public.ig_flows f on f.id = q.flow_id
    where q.status = 'scheduled'
      and q.scheduled_at <= now()
      and q.next_attempt_at <= now()
      and not c.paused
      and not c.reconnect_required
      and (q.flow_id is null or f.state = 'active')
      and not exists (
        select 1
        from public.ig_publication_jobs prior
        where prior.account_id = q.account_id
          and prior.id <> q.id
          and prior.status = 'processing'
      )
      and (
        q.flow_id is null
        or (
          not exists (
            select 1
            from public.ig_publication_jobs prior
            where prior.flow_id = q.flow_id
              and prior.account_id = q.account_id
              and prior.status in ('failed', 'uncertain')
          )
          and not exists (
            select 1
            from public.ig_publication_jobs prior
            where prior.flow_id = q.flow_id
              and prior.account_id = q.account_id
              and prior.status = 'scheduled'
              and (prior.scheduled_at, prior.id) < (q.scheduled_at, q.id)
          )
          and coalesce(
            (
              select max(prior.published_at)
              from public.ig_publication_jobs prior
              where prior.flow_id = q.flow_id
                and prior.account_id = q.account_id
                and prior.status = 'published'
            ),
            '-infinity'::timestamptz
          )
          + make_interval(
            secs =>
              case
                when coalesce(f.settings ->> 'schedule', 'gap') = 'slots'
                  then 180
                else (f.settings ->> 'gapMinutes')::double precision * 60
              end
              + case
                when (
                  select count(*)
                  from public.ig_publication_jobs prior
                  where prior.flow_id = q.flow_id
                    and prior.account_id = q.account_id
                    and prior.status = 'published'
                ) > 0
                and (
                  select count(*)
                  from public.ig_publication_jobs prior
                  where prior.flow_id = q.flow_id
                    and prior.account_id = q.account_id
                    and prior.status = 'published'
                ) % coalesce((f.settings ->> 'batchSize')::integer, 500) = 0
                  then coalesce((f.settings ->> 'restMinutes')::double precision, 0) * 60
                else 0
              end
          ) <= now()
        )
      )
    order by q.scheduled_at
    for update of q skip locked
    limit 1
  )
  returning j.*;
end;
$$;

commit;
