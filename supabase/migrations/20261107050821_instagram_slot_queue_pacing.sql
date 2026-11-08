begin;

-- Return the first real instant for a stored wall-clock slot at or after the
-- cursor. Sampling the offsets around each local day discovers non-hour DST
-- changes too. If a wall time repeats, min() selects its first occurrence;
-- when the cursor has passed it, the remaining occurrence is selected.
create or replace function public.ig_next_slot_at_or_after(
  p_after timestamptz,
  p_slots jsonb,
  p_timezone text
)
returns timestamptz
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  day_offset integer;
  day_date date;
  slot text;
  wall_time timestamp without time zone;
  candidate timestamptz;
begin
  if p_after is null
     or p_slots is null
     or jsonb_typeof(p_slots) <> 'array'
     or jsonb_array_length(p_slots) = 0
     or p_timezone is null then
    return null;
  end if;

  for day_offset in 0..3 loop
    day_date := (p_after at time zone p_timezone)::date + day_offset;
    for slot in select jsonb_array_elements_text(p_slots) loop
      if slot !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        return null;
      end if;

      wall_time := day_date + slot::time;
      select min(((wall_time - offsets.utc_offset) at time zone 'UTC'))
        into candidate
      from (
        select distinct
          (sample at time zone p_timezone) - (sample at time zone 'UTC')
            as utc_offset
        from generate_series(
          (wall_time at time zone 'UTC') - interval '36 hours',
          (wall_time at time zone 'UTC') + interval '36 hours',
          interval '3 hours'
        ) as samples(sample)
      ) as offsets
      where ((wall_time - offsets.utc_offset) at time zone 'UTC') >= p_after
        and (((wall_time - offsets.utc_offset) at time zone 'UTC')
          at time zone p_timezone) = wall_time;

      if candidate is not null then
        return candidate;
      end if;
    end loop;
  end loop;

  return null;
exception
  when invalid_parameter_value then
    return null;
end;
$$;

revoke all on function public.ig_next_slot_at_or_after(timestamptz,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.ig_next_slot_at_or_after(timestamptz,jsonb,text)
  to service_role;

-- Keep campaign GAP pacing unchanged. Fixed-slot claims use the last real
-- confirmation, a global three-minute per-account floor, batch rest, and the
-- next wall-clock slot in the timezone stored with the flow.
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
          and case
            when coalesce(f.settings ->> 'schedule', 'gap') = 'slots' then
              public.ig_next_slot_at_or_after(
                greatest(
                  now() - interval '1 minute 10 seconds',
                  coalesce(
                    (
                      select max(prior.published_at)
                      from public.ig_publication_jobs prior
                      where prior.account_id = q.account_id
                        and prior.status = 'published'
                    ),
                    '-infinity'::timestamptz
                  ) + interval '3 minutes',
                  coalesce(
                    (
                      select max(prior.published_at)
                      from public.ig_publication_jobs prior
                      where prior.flow_id = q.flow_id
                        and prior.account_id = q.account_id
                        and prior.status = 'published'
                    ),
                    '-infinity'::timestamptz
                  ) + interval '3 minutes'
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
                          then make_interval(
                            secs => coalesce(
                              (f.settings ->> 'restMinutes')::double precision,
                              0
                            ) * 60
                          )
                        else interval '0'
                      end
                ),
                f.settings -> 'slots',
                f.settings ->> 'timeZone'
              ) <= now()
            else
              coalesce(
                (
                  select max(prior.published_at)
                  from public.ig_publication_jobs prior
                  where prior.flow_id = q.flow_id
                    and prior.account_id = q.account_id
                    and prior.status = 'published'
                ),
                '-infinity'::timestamptz
              ) + make_interval(
                secs =>
                  (f.settings ->> 'gapMinutes')::double precision * 60
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
                        then coalesce(
                          (f.settings ->> 'restMinutes')::double precision,
                          0
                        ) * 60
                      else 0
                    end
              ) <= now()
          end
        )
      )
    order by q.scheduled_at
    for update of q skip locked
    limit 1
  )
  returning j.*;
end;
$$;

-- CREATE OR REPLACE preserves the existing function ACL; repeat it explicitly
-- so the privileged worker remains the sole callable role.
revoke all on function public.ig_claim_job(uuid) from public, anon, authenticated;
grant execute on function public.ig_claim_job(uuid) to service_role;

commit;
