-- =============================================================================
-- progress-tracker :: 20260917100500_session_rpc
--
-- One round trip that does everything a product request needs before it is
-- served:
--
--   1. proves the caller has a usable identity   (auth.uid() is set, and there
--      is a profile row for it);
--   2. charges the request against this account's quota;
--   3. refreshes last_seen_at, at most once a day;
--   4. hands the backend the profile fields it needs.
--
-- Doing all four in one function is what keeps the identity layer to a single
-- extra Supabase call per request. Doing them in four calls would quadruple the
-- per-request latency of a Lambda that is already paying a network hop.
--
-- IMPORTANT -- WHAT VERIFIES THE TOKEN.
-- Nothing in this repository verifies the JWT. PostgREST does, against the
-- project's signing key, before this function runs: a missing, forged, expired
-- or tampered token never gets here (PostgREST answers 401 itself). So
-- auth.uid() is a verified fact, and the backend needs no JWT secret, no JWKS
-- fetch and no token parsing. That is deliberate -- it is one fewer place that
-- can get signature verification subtly wrong.
--
-- SECURITY DEFINER, and this is the ONE function that runs privileged on a
-- request path. It is safe because it takes no identity from its caller: every
-- statement below is keyed on (select auth.uid()), and the only argument is a
-- kind that must be 'read' or 'write'. It needs the elevation for two reasons:
-- public.rate_limits is granted to no role at all, and last_seen_at is
-- deliberately not in the column-level UPDATE grant a session holds (see
-- 20260917100000), so a session cannot keep itself alive by writing it.
-- =============================================================================

create or replace function public.begin_request(p_kind text default 'read')
returns table (
  user_id uuid,
  display_name text,
  time_zone text,
  week_starts_on smallint,
  is_anonymous boolean,
  last_seen_at timestamptz,
  expires_at timestamptz,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Per-account quotas. Generous for a person, slow for a script.
  --
  -- A dashboard load is three requests (goals, calendar, areas), so 120 reads a
  -- minute is ~40 full page loads a minute from one account -- unreachable by
  -- hand, and a scraper hits it in seconds. The hourly figure is the one that
  -- actually bounds cost: sustained, it is ~72k requests a day per account,
  -- and an attacker who wants more has to keep minting accounts, which is
  -- Supabase's sign-in rate limit's problem, not this function's.
  --
  -- Writes are lower because each one is a row, and the storage caps in
  -- 20260917100200 are the hard stop behind them.
  c_read_per_minute constant integer := 120;
  c_read_per_hour constant integer := 3000;
  c_write_per_minute constant integer := 60;
  c_write_per_hour constant integer := 1000;

  -- last_seen_at only has to be accurate to the day: retention is 90 days, and
  -- the sweep compares whole days. Writing it on every request would cost a row
  -- version (and a WAL record, and autovacuum work) per request to record
  -- something nobody reads at that resolution.
  c_touch_after constant interval := interval '1 day';

  v_auth_uid uuid := (select auth.uid());
  v_user public.users;
  v_retry integer;
begin
  if p_kind not in ('read', 'write') then
    raise exception 'unknown request kind' using errcode = 'invalid_parameter_value';
  end if;

  -- No verified identity, or a verified identity with no profile: return no
  -- rows. The backend renders both as 401, because to a caller they are the
  -- same thing -- "this token cannot be used here" -- and distinguishing them
  -- in the response would describe our internal state to an attacker.
  if v_auth_uid is null then
    return;
  end if;

  select * into v_user from public.users u where u.auth_user_id = v_auth_uid;
  if not found then
    return;
  end if;

  -- Both windows are always charged, even when the first already refuses: if
  -- the minute check short-circuited, an account parked at its minute limit
  -- would stop accumulating hours and could sit there indefinitely.
  v_retry := greatest(
    public.consume_rate_limit(
      p_kind || ':minute', v_user.id, interval '1 minute',
      case p_kind when 'write' then c_write_per_minute else c_read_per_minute end
    ),
    public.consume_rate_limit(
      p_kind || ':hour', v_user.id, interval '1 hour',
      case p_kind when 'write' then c_write_per_hour else c_read_per_hour end
    )
  );

  -- A refused request is not a visit worth recording, and not writing keeps a
  -- flood from turning into a write flood.
  if v_retry = 0 and v_user.last_seen_at < now() - c_touch_after then
    update public.users u
    set last_seen_at = now()
    where u.id = v_user.id
    returning u.last_seen_at into v_user.last_seen_at;
  end if;

  return query select
    v_user.id,
    v_user.display_name,
    v_user.time_zone,
    v_user.week_starts_on,
    v_user.is_anonymous,
    v_user.last_seen_at,
    -- NULL once the account is permanent: it does not expire, and a date the
    -- UI could show would be a lie.
    case when v_user.is_anonymous
      then v_user.last_seen_at + public.anonymous_retention()
    end,
    v_retry;
end;
$$;

comment on function public.begin_request(text) is
  'Resolves the caller''s profile from the verified JWT, charges the request against their quota and refreshes last_seen_at. No rows = no usable identity.';

revoke execute on function public.begin_request(text) from public;
grant execute on function public.begin_request(text) to authenticated;
