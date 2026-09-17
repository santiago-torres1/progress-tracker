-- =============================================================================
-- progress-tracker :: seed.sql  --  THE DEMO'S CONTENT
--
-- 0.1.1-alpha ships as a READ-ONLY live demo: the dashboard and the calendar
-- render real rows from Supabase, and nothing in the app writes. So this file
-- is not a fixture -- it is the only content any visitor will ever see. Treat a
-- change here like a copy change, because that is what it is.
--
-- Eight goals belonging to one fictional but coherent person, spread across all
-- six built-in life areas, covering all three kinds and all three tile sizes.
-- They are deliberately in different shapes of progress, because a dashboard
-- where everything sits at 60% says nothing about the app:
--
--   Bookshelf (scheduled, 12 sessions)  barely started   -- 1 of 12
--   Emergency fund (measured, 0->3000)  nearly full      -- 2,750 of 3,000
--   Back to 78 kg (measured, 84->78)    gently regressed -- last check-in moved
--                                       the wrong way; the app stays calm
--   Read before bed (habit, daily)      at target        -- 1 of 1 today
--   Run 3x a week (habit, weekly)       at its MINIMUM   -- one unplanned run,
--                                       every target day of the week skipped,
--                                       and the app still encourages
--
-- Every date is relative to current_date. There is not a single hardcoded year
-- in this file, on purpose: the demo has to look plausible whenever it is
-- opened, not just in the month it was written. Recurrences are materialised
-- past today so the calendar has a future as well as a past.
--
-- This file is NOT a migration. `supabase db reset` runs it against the LOCAL
-- stack only. Applying it to the hosted project is a deliberate, manual act --
-- and for the read-only demo it IS the intended content, so that is a decision
-- for the human, not something `db push` should ever do by itself.
--
-- Re-runnable: it deletes its own rows first (goal ids prefixed d0000000-...,
-- goal-less calendar items dc000000-...), and deleting a goal cascades to its
-- recurrences, calendar entries and check-ins.
--
-- Remove the demo data again with:
--   delete from public.goals where id::text like 'd0000000-0000-4000-8000-%';
--   delete from public.calendar_entries
--     where goal_id is null and id::text like 'dc000000-0000-4000-8000-%';
-- =============================================================================

delete from public.goals where id::text like 'd0000000-0000-4000-8000-%';
delete from public.calendar_entries
where goal_id is null and id::text like 'dc000000-0000-4000-8000-%';

-- -----------------------------------------------------------------------------
-- Goals
--
-- minimum_count is only set on habits; the goals_before_write trigger would
-- default it to 1, but the demo states it explicitly because it is the point of
-- the "Run 3x a week" tile.
-- -----------------------------------------------------------------------------
insert into public.goals (
  id, user_id, life_area_id, title, description, kind, status, size,
  color_override, start_date, target_date, sort_order,
  measurement_unit, start_value, target_value,
  target_count, minimum_count, habit_period, target_sessions
) values
  -- HABIT, weekly. The owner's rule made visible: aiming for three, and one is
  -- enough to still be doing well. Has planned target days AND accepts runs on
  -- days that were never targets.
  ('d0000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001',          -- Health & Wellbeing
   'Run three times a week',
   'Tuesday, Thursday, Saturday before work. Any run counts, target day or not.',
   'habit', 'active', 'large', null, current_date - 35, null, 10,
   null, null, null, 3, 1, 'week', null),

  -- MEASURED, falling. The one that has gently gone backwards.
  ('d0000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001',          -- Health & Wellbeing
   'Get back to 78 kg',
   'Same scale, Sunday mornings, no drama about any single week.',
   'measured', 'active', 'medium', null, current_date - 42, current_date + 75, 20,
   'kg', 84.0, 78.0, null, null, null, null),

  -- SCHEDULED, finite: progress is sessions actually attended out of 30.
  ('d0000000-0000-4000-8000-000000000003',
   '00000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000002',          -- Learning & Skills
   'Spanish B1 by the summer',
   'Tuesday and Thursday evenings with Marta. Thirty lessons to the exam.',
   'scheduled', 'active', 'large', null, current_date - 77, current_date + 120, 30,
   null, null, null, null, null, null, 30),

  -- MEASURED, rising. Nearly there.
  ('d0000000-0000-4000-8000-000000000004',
   '00000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000003',          -- Money & Finances
   'Three months of rent in the bank',
   'Whatever is left at the end of the month goes straight across.',
   'measured', 'active', 'medium', null, current_date - 97, null, 40,
   'EUR', 0, 3000, null, null, null, null),

  -- HABIT, monthly. A softer rhythm than a weekly one, and a reminder that the
  -- period is not always a week.
  ('d0000000-0000-4000-8000-000000000005',
   '00000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000004',          -- Relationships
   'See friends properly twice a month',
   'Not a message. An actual evening, phone in a pocket.',
   'habit', 'active', 'medium', null, current_date - 70, null, 50,
   null, null, null, 2, 1, 'month', null),

  -- SCHEDULED, open-ended: no finish line, so progress is adherence.
  ('d0000000-0000-4000-8000-000000000006',
   '00000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000005',          -- Work & Career
   'Weekly 1:1 with Dani',
   'Half an hour on Wednesdays. The one meeting that never gets moved.',
   'scheduled', 'active', 'small', null, current_date - 63, null, 60,
   null, null, null, null, null, null, null),

  -- SCHEDULED, finite, barely begun. Large because it matters, not because it
  -- is going well -- which is exactly what size is for.
  ('d0000000-0000-4000-8000-000000000007',
   '00000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000006',          -- Creativity & Hobbies
   'Build the walnut bookshelf',
   'Saturday mornings in the garage. Twelve sessions if nothing goes wrong.',
   'scheduled', 'active', 'large', null, current_date - 21, null, 70,
   null, null, null, null, null, null, 12),

  -- HABIT, daily. No colour_override on purpose: the dashboard shows a colour key
  -- mapping each hue to a life area, so every demo tile inherits its area's colour.
  -- color_override exists in the schema for when a user wants to break that, but the
  -- demo must not, or the key would be lying.
  ('d0000000-0000-4000-8000-000000000008',
   '00000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000006',          -- Creativity & Hobbies
   'Read before bed',
   'Ten pages, paper only, no screens.',
   'habit', 'active', 'small', null, current_date - 30, null, 80,
   null, null, null, 1, 1, 'day', null);

-- -----------------------------------------------------------------------------
-- Recurrence rules, then their materialised occurrences
--
-- Note that a recurrence is NOT only for scheduled goals: the running habit has
-- one too. That is the whole point of rule #4 below -- target days are a plan,
-- not a gate.
-- -----------------------------------------------------------------------------
insert into public.recurrences (
  id, user_id, goal_id, freq, interval_count, byweekday,
  start_date, start_time, end_time, time_zone
)
select v.id, u.id, v.goal_id, 'weekly', 1, v.byweekday,
       v.start_date, v.start_time, v.end_time, u.time_zone
from public.users u
cross join (values
  -- Running: the three target days.
  ('d1000000-0000-4000-8000-000000000001'::uuid,
   'd0000000-0000-4000-8000-000000000001'::uuid,
   array[2, 4, 6]::smallint[], current_date - 35, time '07:00', time '07:45'),
  -- Spanish lessons: Tuesday and Thursday evenings.
  ('d1000000-0000-4000-8000-000000000002'::uuid,
   'd0000000-0000-4000-8000-000000000003'::uuid,
   array[2, 4]::smallint[], current_date - 77, time '19:00', time '20:00'),
  -- The 1:1: Wednesday mid-morning.
  ('d1000000-0000-4000-8000-000000000003'::uuid,
   'd0000000-0000-4000-8000-000000000006'::uuid,
   array[3]::smallint[], current_date - 63, time '10:00', time '10:30'),
  -- Garage time: Saturday mornings.
  ('d1000000-0000-4000-8000-000000000004'::uuid,
   'd0000000-0000-4000-8000-000000000007'::uuid,
   array[6]::smallint[], current_date - 21, time '10:00', time '13:00')
) as v (id, goal_id, byweekday, start_date, start_time, end_time)
where u.id = '00000000-0000-4000-8000-000000000001';

-- Materialise past today, so the calendar has a future. In the running app this
-- is what the horizon job calls.
select public.expand_recurrence('d1000000-0000-4000-8000-000000000001', current_date + 42);
select public.expand_recurrence('d1000000-0000-4000-8000-000000000002', current_date + 42);
select public.expand_recurrence('d1000000-0000-4000-8000-000000000003', current_date + 56);
select public.expand_recurrence('d1000000-0000-4000-8000-000000000004', current_date + 56);

-- -----------------------------------------------------------------------------
-- Resolving the past occurrences
--
-- Everything is keyed off the user's own week start, so the story below reads
-- the same whatever weekday the demo is opened on.
-- -----------------------------------------------------------------------------

-- Running: every target day BEFORE this week was run, except the Thursdays of
-- the last two weeks. This week's target days that have already passed were all
-- skipped -- which is what sets up the minimum rule below.
update public.calendar_entries ce
set status = 'completed'
from public.users u
cross join lateral (
  select public.period_start(current_date, 'week'::public.habit_period, u.week_starts_on) as week_start
) w
where ce.recurrence_id = 'd1000000-0000-4000-8000-000000000001'
  and u.id = ce.user_id
  and ce.entry_date < w.week_start;

update public.calendar_entries ce
set status = 'skipped'
from public.users u
cross join lateral (
  select public.period_start(current_date, 'week'::public.habit_period, u.week_starts_on) as week_start
) w
where ce.recurrence_id = 'd1000000-0000-4000-8000-000000000001'
  and u.id = ce.user_id
  and (
    -- The two missed Thursdays.
    (ce.entry_date >= w.week_start - 14 and ce.entry_date < w.week_start
     and extract(isodow from ce.entry_date)::int = 4)
    -- Every target day of THIS week that has already gone by.
    or (ce.entry_date >= w.week_start and ce.entry_date < current_date)
  );

-- Spanish: attended everything so far except the week off with flu.
update public.calendar_entries ce
set status = 'completed'
where ce.recurrence_id = 'd1000000-0000-4000-8000-000000000002'
  and ce.entry_date < current_date;

update public.calendar_entries ce
set status = 'skipped', notes = 'Flu.'
from public.users u
cross join lateral (
  select public.period_start(current_date, 'week'::public.habit_period, u.week_starts_on) as week_start
) w
where ce.recurrence_id = 'd1000000-0000-4000-8000-000000000002'
  and u.id = ce.user_id
  and ce.entry_date >= w.week_start - 21
  and ce.entry_date < w.week_start - 14;

-- The 1:1: kept every week but one. Open-ended, so this becomes adherence.
update public.calendar_entries ce
set status = 'completed'
where ce.recurrence_id = 'd1000000-0000-4000-8000-000000000003'
  and ce.entry_date < current_date;

update public.calendar_entries ce
set status = 'skipped', notes = 'Dani on holiday.'
from public.users u
cross join lateral (
  select public.period_start(current_date, 'week'::public.habit_period, u.week_starts_on) as week_start
) w
where ce.recurrence_id = 'd1000000-0000-4000-8000-000000000003'
  and u.id = ce.user_id
  and ce.entry_date >= w.week_start - 21
  and ce.entry_date < w.week_start - 14;

-- Bookshelf: exactly one Saturday actually happened. The rest of the past
-- Saturdays were skipped, which is why this tile is barely started.
update public.calendar_entries
set status = 'skipped'
where recurrence_id = 'd1000000-0000-4000-8000-000000000004'
  and entry_date < current_date;

update public.calendar_entries
set status = 'completed', notes = 'Cut and planed the uprights.'
where id = (
  select ce.id
  from public.calendar_entries ce
  where ce.recurrence_id = 'd1000000-0000-4000-8000-000000000004'
  order by ce.entry_date
  limit 1
);

-- -----------------------------------------------------------------------------
-- Unplanned completions
--
-- The product rule, stated as data: "can define target days when wants to run,
-- but can also add the days that they run even if not defined as target, and it
-- would count towards the weekly goal."
--
-- This entry has recurrence_id IS NULL -- no rule produced it, it was logged
-- after the fact, and it lands on the first day of the week, which is never one
-- of the three target days. Every target day this week was skipped, so this ONE
-- ad-hoc run is the entire reason the habit is at its minimum and the app is
-- still encouraging rather than scolding.
-- -----------------------------------------------------------------------------
insert into public.calendar_entries (user_id, goal_id, entry_date, time_zone, status, title, notes)
select
  u.id,
  'd0000000-0000-4000-8000-000000000001',
  public.period_start(current_date, 'week'::public.habit_period, u.week_starts_on),
  u.time_zone,
  'completed',
  'Run',
  'Not a target day. Went anyway.'
from public.users u
where u.id = '00000000-0000-4000-8000-000000000001';

-- A second unplanned run last week, so the pattern is visibly normal and not a
-- one-off glitch in the data.
insert into public.calendar_entries (user_id, goal_id, entry_date, time_zone, status, title, notes)
select
  u.id,
  'd0000000-0000-4000-8000-000000000001',
  public.period_start(current_date, 'week'::public.habit_period, u.week_starts_on) - 6,
  u.time_zone,
  'completed',
  'Run',
  'Ran with Sam instead of the gym.'
from public.users u
where u.id = '00000000-0000-4000-8000-000000000001';

-- -----------------------------------------------------------------------------
-- Habit ticks with no rule behind them at all: untimed entries on the one
-- timeline. Neither of these habits has a recurrence -- they are not scheduled,
-- they just happen.
-- -----------------------------------------------------------------------------

-- Seeing friends: one evening early this month, a second one mid-month once the
-- month has got that far. Before the 14th the tile sits at its minimum (1 of 2)
-- and after it sits at target -- both are states worth looking at, and neither
-- is a failure.
insert into public.calendar_entries (user_id, goal_id, entry_date, time_zone, status, title)
select u.id, 'd0000000-0000-4000-8000-000000000005', d.entry_date, u.time_zone, 'completed', d.title
from public.users u
cross join lateral (
  select date_trunc('month', current_date)::date as month_start
) m
cross join lateral (values
  (m.month_start - 20, 'Dinner at Pau''s'),
  (m.month_start - 9,  'Cinema with Laia'),
  (m.month_start,      'Long lunch, no phones'),
  (m.month_start + 13, 'Sam''s leaving drinks')
) as d (entry_date, title)
where u.id = '00000000-0000-4000-8000-000000000001'
  and d.entry_date <= current_date;

-- Reading: most nights of the last fortnight, with honest gaps -- and always
-- tonight, so the daily habit reads as met.
insert into public.calendar_entries (user_id, goal_id, entry_date, time_zone, status, title)
select u.id, 'd0000000-0000-4000-8000-000000000008', current_date - days_ago, u.time_zone, 'completed', 'Read'
from public.users u
cross join unnest(array[0, 1, 2, 4, 5, 6, 7, 9, 10, 12, 13]) as days_ago
where u.id = '00000000-0000-4000-8000-000000000001';

-- -----------------------------------------------------------------------------
-- Measured goals: numeric check-ins
-- -----------------------------------------------------------------------------

-- Weight: down steadily, then back up a little at the last check-in. This is the
-- regression the dashboard has to show calmly -- progress_fraction drops from
-- 0.5167 to 0.4000, which is still most of the way from 84 kg to 78 kg. Nothing
-- in the schema calls this a failure, and nothing in the UI should either.
-- Each weigh-in is also a calendar entry, linked back: the pattern the API
-- should follow when a check-in happens on a planned day.
with weigh_ins (days_ago, kg, note) as (
  values
    (42, 84.0, 'Starting point.'),
    (28, 82.4, null),
    (14, 80.9, null),
    (3,  81.6, 'Two weeks of travel and restaurant food. Still lighter than I started.')
),
logged as (
  insert into public.calendar_entries (user_id, goal_id, entry_date, time_zone, status, title)
  select u.id, 'd0000000-0000-4000-8000-000000000002', current_date - w.days_ago,
         u.time_zone, 'completed', 'Weigh-in'
  from weigh_ins w
  cross join public.users u
  where u.id = '00000000-0000-4000-8000-000000000001'
  returning id, entry_date
)
insert into public.progress_entries (user_id, goal_id, calendar_entry_id, occurred_on, value, note)
select '00000000-0000-4000-8000-000000000001',
       'd0000000-0000-4000-8000-000000000002',
       l.id, l.entry_date, w.kg, w.note
from logged l
join weigh_ins w on current_date - w.days_ago = l.entry_date;

-- Savings: no calendar entries at all. A measured goal does not need them, and
-- the dashboard must not look broken when they are absent.
insert into public.progress_entries (user_id, goal_id, occurred_on, value, note)
select '00000000-0000-4000-8000-000000000001',
       'd0000000-0000-4000-8000-000000000004',
       current_date - v.days_ago, v.amount, v.note
from (values
  (97, 250,  'Opened the account.'),
  (66, 900,  null),
  (35, 1780, null),
  (5,  2750, 'Sold the old bike. Nearly there.')
) as v (days_ago, amount, note);

-- -----------------------------------------------------------------------------
-- Two calendar items that belong to no goal (goal_id IS NULL), so the calendar
-- is a calendar and not just a projection of the dashboard.
-- -----------------------------------------------------------------------------
insert into public.calendar_entries (id, user_id, goal_id, entry_date, start_at, end_at, time_zone, status, title)
select
  'dc000000-0000-4000-8000-000000000001', u.id, null,
  current_date + 9,
  ((current_date + 9) + time '09:30') at time zone u.time_zone,
  ((current_date + 9) + time '10:15') at time zone u.time_zone,
  u.time_zone, 'planned', 'Dentist'
from public.users u
where u.id = '00000000-0000-4000-8000-000000000001';

insert into public.calendar_entries (id, user_id, goal_id, entry_date, time_zone, status, title)
select
  'dc000000-0000-4000-8000-000000000002', u.id, null,
  current_date + 17, u.time_zone, 'planned', 'Mum''s birthday'
from public.users u
where u.id = '00000000-0000-4000-8000-000000000001';
