-- =============================================================================
-- progress-tracker :: 20260916090300_progress_views
--
-- Progress is COMPUTED, not stored. Every input (a completed occurrence, a
-- check-in) is already a row, so a cached percentage would only add a way for
-- the dashboard to be wrong. If these views ever get slow, the fix is a
-- materialised view refreshed on write -- not a denormalised column.
--
-- Both views are SECURITY INVOKER (PostgreSQL 15+, which Supabase runs), so the
-- caller's row-level security applies to the underlying tables. Without that
-- flag a view runs as its owner and would leak every user's rows.
--
-- progress_fraction is 0..1, or NULL when a goal genuinely has no denominator
-- (an open-ended scheduled goal with nothing due yet). progress_basis says
-- which rule produced it so the UI can label it honestly.
--
-- The view also resolves the owner's encouragement rule so no client re-derives
-- it: for a habit, period_minimum_met answers "is this person still keeping
-- this habit?" and it is TRUE from the first completion of the period up.
-- Nothing here ever reports a failure state; the dashboard is not meant to have
-- to invent one.
-- =============================================================================

create or replace view public.goal_progress
with (security_invoker = true) as
with entry_stats as (
  -- One row per goal, counting its occurrences. 'cancelled' entries are
  -- excluded everywhere: they are mistakes, not missed sessions.
  select
    ce.goal_id,
    count(*) filter (where ce.status <> 'cancelled')::integer as planned_count,
    count(*) filter (where ce.status = 'completed')::integer as completed_count,
    count(*) filter (
      where ce.status <> 'cancelled'
        and ce.entry_date <= (now() at time zone u.time_zone)::date
    )::integer as due_count,
    count(*) filter (
      where ce.status = 'completed'
        and ce.entry_date <= (now() at time zone u.time_zone)::date
    )::integer as completed_due_count,
    max(ce.entry_date) filter (where ce.status = 'completed') as last_completed_on
  from public.calendar_entries ce
  join public.users u on u.id = ce.user_id
  where ce.goal_id is not null
  group by ce.goal_id
),
ranked_measurements as (
  -- Two check-ins are wanted, not one -- the previous value is what lets the UI
  -- say "up 0.7 kg since the 3rd" calmly instead of just showing a smaller
  -- ring with no explanation. row_number() rather than DISTINCT ON because
  -- DISTINCT ON cannot return the runner-up.
  select
    pe.goal_id,
    pe.value,
    pe.occurred_on,
    row_number() over (
      partition by pe.goal_id
      order by pe.occurred_on desc, pe.created_at desc
    ) as rn
  from public.progress_entries pe
),
latest_measurement as (
  select rm.goal_id, rm.value, rm.occurred_on from ranked_measurements rm where rm.rn = 1
),
previous_measurement as (
  select rm.goal_id, rm.value, rm.occurred_on from ranked_measurements rm where rm.rn = 2
)
select
  g.id as goal_id,
  g.user_id,
  g.kind,
  g.status,

  -- "Today" is the user's today, not the server's.
  t.today,

  -- Habit window (NULL for the other kinds: period_start/_end are STRICT and
  -- habit_period is NULL there).
  p.period_start,
  p.period_end,
  pc.period_completed_count,
  g.target_count as period_target_count,
  g.minimum_count as period_minimum_count,

  -- The owner's rule, answered in SQL: "as long as the minimum is met, keep
  -- encouraging." TRUE/FALSE for habits, NULL for the other kinds (the idea
  -- does not apply to them). FALSE is not a failure -- it means the nudge
  -- should be "one is enough this week", not "you missed".
  case when g.kind = 'habit'
    then pc.period_completed_count >= g.minimum_count
  end as period_minimum_met,

  -- How far into the minimum, 0..1. Hits exactly 1 at the moment
  -- period_minimum_met flips true, so one meter can render both.
  case when g.kind = 'habit' then round(
    least(1::numeric, pc.period_completed_count::numeric / g.minimum_count), 4)
  end as period_minimum_fraction,

  -- Measured
  coalesce(m.value, g.start_value) as current_value,
  g.start_value,
  g.target_value,
  g.measurement_unit,
  m.occurred_on as last_measured_on,
  pm.value as previous_value,
  pm.occurred_on as previous_measured_on,

  -- Scheduled
  coalesce(es.planned_count, 0) as planned_count,
  coalesce(es.completed_count, 0) as completed_count,
  coalesce(es.due_count, 0) as due_count,
  coalesce(es.completed_due_count, 0) as completed_due_count,
  g.target_sessions,

  -- "When did I last make progress" across both sources. GREATEST ignores NULLs.
  greatest(es.last_completed_on, m.occurred_on) as last_progress_on,

  case g.kind
    when 'measured' then 'measured_value'
    when 'habit' then 'period_completion'
    when 'scheduled' then
      case
        when g.target_sessions is not null then 'session_target'
        when coalesce(es.due_count, 0) > 0 then 'session_adherence'
        else 'none'
      end
  end as progress_basis,

  case g.kind
    -- Works in both directions: (79-82)/(77-82) = 0.6 falling,
    -- (450-0)/(2000-0) = 0.225 rising. Clamped to [0,1].
    when 'measured' then round(
      greatest(0::numeric, least(1::numeric,
        (coalesce(m.value, g.start_value) - g.start_value) / (g.target_value - g.start_value)
      )), 4)

    -- This period only: "Run 3x a week" is 2/3 today and 0/3 on Monday.
    when 'habit' then round(
      least(1::numeric, pc.period_completed_count::numeric / g.target_count), 4)

    when 'scheduled' then
      case
        -- Finite goal: sessions kept out of the number promised.
        when g.target_sessions is not null then round(
          least(1::numeric, coalesce(es.completed_count, 0)::numeric / g.target_sessions), 4)
        -- Open-ended: adherence so far, which is the only honest 0..1.
        when coalesce(es.due_count, 0) > 0 then round(
          coalesce(es.completed_due_count, 0)::numeric / es.due_count, 4)
        else null
      end
  end as progress_fraction
from public.goals g
join public.users u on u.id = g.user_id
cross join lateral (select (now() at time zone u.time_zone)::date as today) t
cross join lateral (
  select
    public.period_start(t.today, g.habit_period, u.week_starts_on) as period_start,
    public.period_end(t.today, g.habit_period, u.week_starts_on) as period_end
) p
left join entry_stats es on es.goal_id = g.id
left join latest_measurement m on m.goal_id = g.id
left join previous_measurement pm on pm.goal_id = g.id
cross join lateral (
  -- Completed occurrences inside the current habit window. For non-habits the
  -- bounds are NULL, so this is 0 and unused.
  --
  -- Deliberately NOT filtered on recurrence_id: a completion logged on a day
  -- the rule never planned counts exactly like a planned one. "Can define
  -- target days to run, but can also add the days they run even if not a
  -- target day, and it counts towards the weekly goal."
  select count(*)::integer as period_completed_count
  from public.calendar_entries ce
  where ce.goal_id = g.id
    and ce.status = 'completed'
    and ce.entry_date >= p.period_start
    and ce.entry_date <= p.period_end
) pc;

comment on view public.goal_progress is
  'One row per goal with a comparable progress_fraction (0..1, NULL when undefined), the raw counts behind it, and period_minimum_met for habits.';

-- -----------------------------------------------------------------------------
-- The dashboard's single query surface: goal + area + effective colour + progress.
-- -----------------------------------------------------------------------------
create or replace view public.goal_dashboard
with (security_invoker = true) as
select
  g.id,
  g.user_id,
  g.title,
  g.description,
  g.kind,
  g.status,
  -- Tile size on the canvas. sort_order survives alongside it purely so an
  -- unsorted canvas still lays out deterministically across reloads.
  g.size,
  g.sort_order,

  g.life_area_id,
  la.slug as life_area_slug,
  la.name as life_area_name,
  la.icon as life_area_icon,
  -- Per-goal override wins, then the area's colour, then a neutral fallback.
  -- The design agent owns the actual palette; these are data, not styling.
  coalesce(g.color_override, la.color, '#64748B') as color,

  g.start_date,
  g.target_date,

  g.measurement_unit,
  g.start_value,
  g.target_value,
  gp.current_value,
  gp.last_measured_on,
  gp.previous_value,
  gp.previous_measured_on,

  g.target_count,
  g.minimum_count,
  g.habit_period,
  gp.period_start,
  gp.period_end,
  gp.period_completed_count,
  gp.period_minimum_met,
  gp.period_minimum_fraction,

  g.target_sessions,
  gp.planned_count,
  gp.completed_count,
  gp.due_count,

  gp.progress_basis,
  gp.progress_fraction,
  gp.last_progress_on,

  g.completed_at,
  g.archived_at,
  g.created_at,
  g.updated_at
from public.goals g
left join public.life_areas la on la.id = g.life_area_id
join public.goal_progress gp on gp.goal_id = g.id;

comment on view public.goal_dashboard is
  'Everything the goals dashboard renders for one goal. Filter by user_id/status, order by sort_order, created_at.';
