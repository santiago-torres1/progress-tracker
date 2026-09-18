-- =============================================================================
-- progress-tracker :: 20260917100300_rate_limits
--
-- Rate limiting for an API that runs on Lambda.
--
-- WHY THE COUNTER IS IN POSTGRES AND NOT IN THE PROCESS
--
-- The obvious implementation -- a token bucket in module scope -- does not
-- mean what it says on Lambda. There is no shared memory between execution
-- environments, so "60 requests a minute" becomes "60 per minute per warm
-- instance", and the real ceiling is (instances x limit). Worse, the ceiling
-- moves: a burst scales out and every new instance starts with a full bucket,
-- so the limiter is loosest exactly when it is needed. It also forgets
-- everything when an instance is recycled, which an attacker can provoke.
--
-- A row in Postgres is one shared counter for every instance, survives scaling
-- and recycling, and -- the reason this design is cheap -- it costs no extra
-- round trip, because public.begin_request() already makes one to resolve the
-- caller's profile and refresh last_seen_at. The counter is incremented in the
-- same call.
--
-- WHAT IT COSTS: one UPSERT per product request. Each is a row version, so the
-- table churns and needs autovacuum; it is kept tiny by bucketing (one row per
-- subject per window, not per request) and swept by
-- public.delete_expired_rate_limits().
--
-- WHAT IT DOES NOT STOP -- see supabase/README.md for the full list:
--   * Requests with no token, or an invalid one. Those are rejected before any
--     database call, so they never reach this counter. Their cost is a Lambda
--     invocation, which is bounded by reserved concurrency, not by us.
--   * Mass account creation. One session per account means an attacker who can
--     mint accounts gets a fresh quota each time. The defence for that is
--     Supabase's own per-IP anonymous sign-in rate limit (Auth -> Rate Limits
--     in the dashboard), not this table.
-- =============================================================================

-- One row per (scope, subject, window). Fixed windows, not a sliding log:
-- a sliding window needs a row per request, which is the thing being avoided.
-- The honest cost of a fixed window is that a caller can spend the tail of one
-- window and the head of the next back to back, i.e. up to 2x the limit across
-- a window boundary. Two windows of different sizes (see begin_request) blunt
-- that: the burst passes the minute check and the hour check still holds.
create table if not exists public.rate_limits (
  scope text not null,
  -- Always public.users.id, and always derived from the verified JWT inside
  -- begin_request -- never a value the caller sent. That is what makes the key
  -- unforgeable.
  subject uuid not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (scope, subject, window_start)
);

comment on table public.rate_limits is
  'Fixed-window request counters shared by every Lambda instance. Written only by public.consume_rate_limit(); no role has direct access.';

-- The sweep's driving scan.
create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- No role is granted anything on this table and no policy exists, so the only
-- way in is through the SECURITY DEFINER function below. RLS is enabled anyway:
-- the table is in the public schema and therefore visible to PostgREST, and an
-- RLS-less public table is both a lint failure and one accidental GRANT away
-- from being world-readable.
alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from anon, authenticated;

-- -----------------------------------------------------------------------------
-- public.consume_rate_limit(scope, subject, window, limit)
--
-- Counts one request and answers "how long must this caller wait?" -- 0 when
-- the request is allowed, otherwise the whole seconds left in the current
-- window (never 0, so a caller is never told to retry immediately).
--
-- The INSERT ... ON CONFLICT DO UPDATE is a single atomic statement, so
-- concurrent requests from the same subject cannot both read the same count.
-- No advisory lock is needed or wanted here.
--
-- Rejected requests are counted too. That is deliberate: a caller that keeps
-- hammering keeps the counter above the limit for the rest of the window
-- rather than being handed a free slot the moment one falls out.
-- -----------------------------------------------------------------------------
create or replace function public.consume_rate_limit(
  p_scope text,
  p_subject uuid,
  p_window interval,
  p_limit integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_seconds bigint := floor(extract(epoch from p_window))::bigint;
  v_window_start timestamptz;
  v_count integer;
begin
  if v_window_seconds <= 0 or p_limit <= 0 then
    raise exception 'invalid rate limit configuration' using errcode = 'invalid_parameter_value';
  end if;

  -- Bucket the clock: every subject in the system shares window boundaries,
  -- which is what keeps this to one row per subject per window.
  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / v_window_seconds) * v_window_seconds
  );

  insert into public.rate_limits as rl (scope, subject, window_start, request_count)
  values (p_scope, p_subject, v_window_start, 1)
  on conflict (scope, subject, window_start)
    do update set request_count = rl.request_count + 1
  returning rl.request_count into v_count;

  if v_count <= p_limit then
    return 0;
  end if;

  return greatest(
    1,
    ceil(extract(epoch from (v_window_start + p_window) - clock_timestamp()))::integer
  );
end;
$$;

comment on function public.consume_rate_limit(text, uuid, interval, integer) is
  'Counts one request in a fixed window. Returns 0 when allowed, else seconds until the window resets.';

-- Internal: only public.begin_request() (SECURITY DEFINER, so it runs as this
-- function's owner) and maintenance should ever call it. Sessions must not be
-- able to invoke it directly with a subject of their choosing.
revoke execute on function public.consume_rate_limit(text, uuid, interval, integer) from public;
grant execute on function public.consume_rate_limit(text, uuid, interval, integer) to service_role;

-- -----------------------------------------------------------------------------
-- Sweep. Counters are worthless once their window has passed; keeping them
-- would turn a bounded table into an unbounded one.
--
-- Deliberately generous (a day, not two windows) so a run that is skipped does
-- not delete a window that is still being counted, and so the table can still
-- be looked at after the fact when investigating abuse.
-- -----------------------------------------------------------------------------
create or replace function public.delete_expired_rate_limits(
  p_older_than interval default interval '1 day'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limits rl where rl.window_start < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.delete_expired_rate_limits(interval) from public;
grant execute on function public.delete_expired_rate_limits(interval) to service_role;
