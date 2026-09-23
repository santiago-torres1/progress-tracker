-- =============================================================================
-- progress-tracker :: 20260923100000_session_overview
--
-- 0.3.0-alpha. The profile page needs a handful of facts about the account
-- itself, and GET /api/session had nowhere to get them: public.begin_request()
-- returns the preferences it has to resolve anyway, and nothing else.
--
-- Additive: one view and one index. No table, column, policy or grant on an
-- existing object changes, so applying this to the live project cannot alter
-- what any current route reads or writes.
--
-- WHY A VIEW RATHER THAN FOUR COUNTS IN TYPESCRIPT.
-- The counts below are over rows the API deliberately never fetches -- every
-- calendar entry and every check-in the account has ever recorded. Counting
-- them in the backend would mean paging tens of thousands of rows across the
-- network to produce a single integer, and it would put arithmetic behind the
-- database's back, which is the rule public.goal_progress already exists to
-- keep ("progress is COMPUTED, not stored", 20260916090300).
--
-- WHY NOT ADD THEM TO public.begin_request().
-- begin_request runs on EVERY /api request. Four aggregates there would charge
-- the dashboard, the calendar and every write for a number only the profile
-- page reads. They live here instead, and only the one route that needs them
-- pays for them.
--
-- SECURITY INVOKER, like the progress views. The caller's row-level security
-- applies to public.users and to each table counted below, so a session sees
-- exactly one row -- its own -- and the counts can only ever be of its own
-- rows. Without the flag the view would run as its owner and hand every
-- session the same totals for everybody.
-- =============================================================================

-- The per-account completion count's driving scan. calendar_entries_user_date_idx
-- is (user_id, entry_date, start_at) and carries no status, so without this the
-- count reads every entry the account holds (up to 750 per goal) and filters.
-- Partial, so it stays the size of the completed set rather than of the table.
create index if not exists calendar_entries_user_completed_idx
  on public.calendar_entries (user_id) where status = 'completed';

-- -----------------------------------------------------------------------------
-- public.session_overview -- one row per account: when it appeared, and what
-- is on its board.
--
-- WHAT THESE NUMBERS ARE, AND WHAT THEY ARE DELIBERATELY NOT.
-- Plain facts, and nothing that ranks, compares or rewards. There is no score,
-- no streak, no best-ever and no total anyone could be behind on: this product
-- has no failure state, and a profile page that invented one here would be the
-- easiest place to break that rule by accident. Every column below is something
-- the person could count on their own screen if they had the patience.
-- -----------------------------------------------------------------------------
create or replace view public.session_overview
with (security_invoker = true) as
select
  -- Never selected by the API (no response carries an account id); it is here
  -- so a maintenance query can join this view to a row like any other.
  u.id as user_id,

  -- When the account first appeared. For an anonymous visitor this is the
  -- moment they first loaded the page, which is the only "member since" that
  -- exists for an account with no sign-up.
  u.created_at,

  -- Whole days from the day the account appeared to the caller's own today,
  -- both resolved in the account's time zone -- the same clock "complete today"
  -- and every habit period already use. 0 on the first day. Computed here
  -- rather than in the browser because a client that subtracted two instants
  -- would get a different number either side of midnight in its own zone,
  -- which is the exact bug public.users.time_zone exists to prevent.
  (t.today - (u.created_at at time zone u.time_zone)::date)::integer as days_since_start,

  -- What is on the board right now, and what has filled up. 'active' is
  -- precisely what GET /api/goals returns by default, so this number always
  -- matches the tiles the person can see; 'completed' and 'archived' are the
  -- full glasses, together, because archiving is how a finished goal is filed
  -- away rather than a different outcome. A paused goal is in neither: it is
  -- not on the board and it is not finished.
  g.goals_on_board,
  g.glasses_filled,

  -- The two ways a person tells this app something happened: ticking an
  -- occurrence off, and logging a number. Counted separately because they are
  -- different acts -- summing them would invent a single "activity" figure
  -- nobody recorded.
  c.completions_recorded,
  m.measurements_recorded
from public.users u
cross join lateral (select (now() at time zone u.time_zone)::date as today) t
cross join lateral (
  -- One pass over this account's goals for both counts; goals_user_status_idx
  -- is (user_id, status), which is exactly this.
  select
    count(*) filter (where gl.status = 'active')::integer as goals_on_board,
    count(*) filter (where gl.status in ('completed', 'archived'))::integer as glasses_filled
  from public.goals gl
  where gl.user_id = u.id
) g
cross join lateral (
  -- Entries with no goal (a dentist appointment) count too: the person ticked
  -- them off, and the number claims nothing more than that.
  select count(*)::integer as completions_recorded
  from public.calendar_entries ce
  where ce.user_id = u.id and ce.status = 'completed'
) c
cross join lateral (
  select count(*)::integer as measurements_recorded
  from public.progress_entries pe
  where pe.user_id = u.id
) m;

comment on view public.session_overview is
  'One row per account for the profile page: created_at, days_since_start in the account''s own zone, and plain counts of goals on the board, full glasses, completions and measurements. No ranking, no score, no streak.';

-- The explicit privileges Supabase's defaults would have granted anyway, said
-- out loud so a change to those defaults cannot quietly widen this. anon holds
-- nothing: it satisfies no policy on public.users, so it could only ever read
-- zero rows, and saying so costs nothing.
revoke all on table public.session_overview from anon, authenticated;
grant select on table public.session_overview to authenticated, service_role;
