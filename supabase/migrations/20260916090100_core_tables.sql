-- =============================================================================
-- progress-tracker :: 20260916090100_core_tables
--
-- The six tables the goals dashboard is built on:
--
--   users             one row per person (exactly one while there is no login)
--   life_areas        health / relationships / finances / ... , colour lives here
--   goals             one row per goal, of one of three kinds
--   recurrences       the repeat RULE behind a scheduled goal ("Tue+Thu 19:00")
--   calendar_entries  the single timeline: one row per occurrence, timed or not
--   progress_entries  numeric check-ins ("81.4 kg on 2026-09-08")
--
-- Constraints here are documentation: they are written so impossible states
-- cannot be stored. CHECKs never contain subqueries (PostgreSQL forbids it);
-- cross-row/cross-table invariants are enforced with composite foreign keys or
-- triggers instead.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),

  -- Set once real auth arrives; then this becomes
  --   references auth.users (id) on delete cascade
  -- It is deliberately unconstrained today: there is no auth.users row to point
  -- at, and adding the FK later is a one-line ALTER (see supabase/README.md).
  auth_user_id uuid unique,

  display_name text not null default 'Me',

  -- IANA name. Drives "what day is it for this user", habit period boundaries
  -- and the wall-clock interpretation of recurring sessions. Validated by trigger.
  time_zone text not null default 'UTC',

  -- ISO day number the user's week starts on: 1 = Monday ... 7 = Sunday.
  week_starts_on smallint not null default 1,

  -- Marks the single login-less local user. A partial unique index (next
  -- migration) allows at most one true.
  is_default boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint users_display_name_not_blank check (btrim(display_name) <> ''),
  constraint users_time_zone_not_blank check (btrim(time_zone) <> ''),
  constraint users_week_starts_on_iso check (week_starts_on between 1 and 7)
);

comment on table public.users is
  'Application user. While login is unimplemented there is exactly one row, flagged is_default.';
comment on column public.users.auth_user_id is
  'Future FK to auth.users(id). NULL until the account is claimed by a real login.';

-- -----------------------------------------------------------------------------
-- life_areas
--
-- A table rather than an enum because the owner expects this list to grow, and
-- growing it must not require a migration. Two flavours in one table:
--   user_id IS NULL     -> built-in area, visible to everyone, seeded by
--                          migration 20260916090500 (is_system = true)
--   user_id IS NOT NULL -> the user's own area
-- -----------------------------------------------------------------------------
create table if not exists public.life_areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete cascade,
  slug text not null,
  name text not null,

  -- The area's colour. A goal inherits it unless it sets goals.color_override.
  color text not null,

  -- Optional icon key for the UI; the design agent owns what the keys mean.
  icon text,

  sort_order integer not null default 0,
  is_system boolean generated always as (user_id is null) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint life_areas_slug_format check (slug ~ '^[a-z][a-z0-9_-]{1,39}$'),
  constraint life_areas_name_not_blank check (btrim(name) <> ''),
  constraint life_areas_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$')
);

comment on table public.life_areas is
  'Areas of life (health, finances, ...). Rows with user_id IS NULL are built-in and shared.';

-- -----------------------------------------------------------------------------
-- goals
--
-- One table for all three kinds. The alternative -- a base table plus one table
-- per kind -- buys stronger typing but makes the dashboard a three-way join or
-- union for no real gain at this size. The kind-specific columns are instead
-- policed by a single CHECK so a goal can never carry fields of another kind.
-- -----------------------------------------------------------------------------
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  life_area_id uuid references public.life_areas (id) on delete set null,

  title text not null,
  description text,

  kind public.goal_kind not null,
  status public.goal_status not null default 'active',

  -- How big this goal's tile is drawn. The dashboard is an unsorted canvas and
  -- size is how the person says "this one matters more" -- it is NOT derived
  -- from progress, deadline or kind, and the app never changes it on its own.
  size public.goal_size not null default 'medium',

  -- Per-goal colour that wins over the area's colour. NULL = inherit.
  color_override text,

  start_date date,
  target_date date,

  -- Manual dashboard ordering; ties broken by created_at.
  sort_order integer not null default 0,

  -- kind = 'measured' -------------------------------------------------------
  -- Direction is derived, not stored: start_value > target_value means the
  -- number must fall (82 kg -> 77 kg), start_value < target_value means it must
  -- rise (0 -> 2000 saved). One formula covers both; see public.goal_progress.
  measurement_unit text,
  start_value numeric(14, 4),
  target_value numeric(14, 4),

  -- kind = 'habit' ----------------------------------------------------------
  -- target_count is what the person is aiming for ("run 4x a week").
  -- minimum_count is the floor that still counts as keeping the habit alive
  -- ("...but 1x a week and the app is still on your side"). 1 <= minimum_count
  -- <= target_count, defaulted to 1 by the goals_before_write trigger rather
  -- than by a column DEFAULT -- see that trigger for why.
  target_count integer,
  minimum_count integer,
  habit_period public.habit_period,

  -- kind = 'scheduled' ------------------------------------------------------
  -- Optional finite goal ("20 lessons"). NULL means open-ended, and progress
  -- falls back to adherence (sessions kept / sessions due so far).
  target_sessions integer,

  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Lets child tables carry a denormalised user_id that CANNOT disagree with
  -- the goal's owner: they use a composite FK (goal_id, user_id) -> this key.
  constraint goals_id_user_id_key unique (id, user_id),

  constraint goals_title_not_blank check (btrim(title) <> '' and length(title) <= 200),
  constraint goals_color_hex check (color_override is null or color_override ~ '^#[0-9A-Fa-f]{6}$'),
  constraint goals_dates_ordered check (
    start_date is null or target_date is null or target_date >= start_date
  ),

  -- A completed goal keeps its completed_at when it is later archived; any
  -- return to active/paused clears both stamps (trigger goals_before_write).
  constraint goals_completed_at_requires_status check (
    completed_at is null or status in ('completed', 'archived')
  ),
  constraint goals_archived_at_matches_status check (
    (archived_at is not null) = (status = 'archived')
  ),

  -- The shape of a goal, by kind. `else false` is deliberate: adding a value to
  -- public.goal_kind without deciding its required fields fails loudly here
  -- rather than silently allowing a half-defined goal.
  constraint goals_kind_fields check (
    case kind
      when 'measured' then
        start_value is not null
        and target_value is not null
        and target_value <> start_value
        and target_count is null
        and minimum_count is null
        and habit_period is null
        and target_sessions is null
      when 'habit' then
        target_count is not null
        and target_count > 0
        -- The encouragement floor only exists on habits, is always present
        -- there, and can never be above the target it is a floor for.
        and minimum_count is not null
        and minimum_count >= 1
        and minimum_count <= target_count
        and habit_period is not null
        and start_value is null
        and target_value is null
        and measurement_unit is null
        and target_sessions is null
      when 'scheduled' then
        (target_sessions is null or target_sessions > 0)
        and start_value is null
        and target_value is null
        and measurement_unit is null
        and target_count is null
        and minimum_count is null
        and habit_period is null
      else false
    end
  )
);

comment on table public.goals is
  'A goal of one of three kinds: scheduled (sessions), measured (a number moving to a target), habit (repetition per period).';
comment on column public.goals.size is
  'Dashboard tile size: how important this goal is to its owner. Author-chosen, never derived.';
comment on column public.goals.minimum_count is
  'Habits only. Completions per period that still count as keeping the habit: at or above it the app encourages rather than scolds. 1 <= minimum_count <= target_count.';
comment on column public.goals.target_sessions is
  'Scheduled goals only. NULL = open-ended; progress then reports adherence instead of completion.';

-- -----------------------------------------------------------------------------
-- recurrences
--
-- The repeat rule for a scheduled goal. A deliberately small subset of RFC 5545
-- RRULE: FREQ (daily|weekly|monthly) + INTERVAL + BYDAY for weekly. Monthly
-- repeats on start_date's day of the month.
--
-- start_time/end_time are LOCAL WALL CLOCK times plus an IANA zone, never
-- timestamptz. "19:00 in Europe/Madrid every Tuesday" must stay 19:00 across a
-- DST change; storing an instant and adding 7 days would drift by an hour.
-- Occurrences are materialised into calendar_entries by public.expand_recurrence.
-- -----------------------------------------------------------------------------
create table if not exists public.recurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  goal_id uuid not null,

  freq public.recurrence_freq not null,
  interval_count smallint not null default 1,

  -- Weekly only: ISO day numbers, e.g. '{2,4}' = Tuesday and Thursday.
  byweekday smallint[],

  start_date date not null,
  until_date date,

  start_time time,
  end_time time,
  time_zone text not null,

  -- Last date occurrences have been materialised through. NULL = nothing yet.
  generated_through date,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint recurrences_goal_fk
    foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade,
  constraint recurrences_interval_positive check (interval_count > 0),
  constraint recurrences_until_after_start check (until_date is null or until_date >= start_date),
  -- Timed or untimed, never half of each.
  constraint recurrences_times_paired check ((start_time is null) = (end_time is null)),
  -- Sessions do not cross midnight in the alpha (see README "Deferred").
  constraint recurrences_times_ordered check (start_time is null or end_time > start_time),
  constraint recurrences_byweekday_values check (
    byweekday is null or (
      array_length(byweekday, 1) between 1 and 7
      and byweekday <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
    )
  ),
  constraint recurrences_weekly_needs_byweekday check ((freq = 'weekly') = (byweekday is not null))
);

comment on table public.recurrences is
  'Repeat rule behind a scheduled goal. Occurrences are materialised into calendar_entries.';

-- -----------------------------------------------------------------------------
-- calendar_entries
--
-- ONE timeline for every goal kind. An entry is either
--   timed   -- start_at/end_at set (a Spanish lesson, 19:00-20:00), or
--   untimed -- date only (a habit tick, a weigh-in day, an all-day item).
--
-- entry_date is always present. For timed entries it is DERIVED from start_at
-- in the user's zone by a trigger, so the fast "give me this week" index scan
-- can never disagree with the instant that is actually stored.
-- -----------------------------------------------------------------------------
create table if not exists public.calendar_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,

  -- NULL = a plain calendar item that drives no goal (dentist, birthday).
  goal_id uuid,

  -- NULL = one-off. Set = materialised from that rule.
  recurrence_id uuid references public.recurrences (id) on delete set null,

  -- NULL = show the goal's title.
  title text,
  notes text,

  entry_date date not null,
  start_at timestamptz,
  end_at timestamptz,

  -- Zone the local day/wall time were authored in; inherited from the
  -- recurrence, else the user, by trigger.
  time_zone text not null,

  status public.entry_status not null default 'planned',
  completed_at timestamptz,

  -- True once this single occurrence has been edited away from its rule, so
  -- regenerating the series must not overwrite or delete it.
  is_exception boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- MATCH SIMPLE: not enforced while goal_id is NULL, which is exactly right
  -- for goal-less entries; user_id is still anchored by its own FK above.
  constraint calendar_entries_goal_fk
    foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade,

  -- An untimed entry must not have an end time.
  constraint calendar_entries_timing_paired check ((start_at is null) = (end_at is null)),
  constraint calendar_entries_timing_ordered check (start_at is null or end_at > start_at),
  constraint calendar_entries_completed_at_matches_status check (
    (completed_at is not null) = (status = 'completed')
  ),
  constraint calendar_entries_title_not_blank check (title is null or btrim(title) <> '')
);

comment on table public.calendar_entries is
  'The one timeline. Timed (start_at/end_at) or untimed (entry_date only); goal-linked or not.';
comment on column public.calendar_entries.entry_date is
  'Local calendar day. Derived from start_at + time_zone for timed entries; supplied for untimed ones.';

-- -----------------------------------------------------------------------------
-- progress_entries
--
-- Numeric check-ins for measured goals ("81.4 kg", "450 saved"). Repetition
-- progress is NOT duplicated here: a completed calendar_entry is the record of
-- a session kept or a habit ticked. public.goal_progress unifies the two.
-- -----------------------------------------------------------------------------
create table if not exists public.progress_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  goal_id uuid not null,

  -- Set when the check-in was logged from a calendar entry, so the timeline and
  -- the measurement stay linked without duplicating either.
  calendar_entry_id uuid references public.calendar_entries (id) on delete set null,

  -- Day granularity on purpose: a weigh-in happens on a day, not at an instant.
  occurred_on date not null,

  value numeric(14, 4) not null,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint progress_entries_goal_fk
    foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade
);

comment on table public.progress_entries is
  'Numeric check-ins for measured goals. The latest one by (occurred_on, created_at) is "current value".';
