-- =============================================================================
-- progress-tracker :: 20260916090000_init_types_and_helpers
--
-- Enum types and the helper/trigger functions that do not depend on any table.
-- Table-dependent helpers live in later migrations so their bodies can be
-- validated at CREATE time.
--
-- No extensions are created: gen_random_uuid() has been in core PostgreSQL
-- since 13, and Supabase runs 15+, so pgcrypto is not required.
--
-- Every object is schema-qualified and every function pins an empty
-- search_path (pg_catalog is always implicitly searched), which is both the
-- Supabase linter's recommendation and what makes SECURITY-sensitive code safe.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enum types
--
-- These sets are closed by design. Enums (rather than text + CHECK) are used
-- because `supabase gen types typescript` turns an enum into a real TS union
-- (`'scheduled' | 'measured' | 'habit'`) while a CHECK constraint only yields
-- `string` -- and this project is TypeScript-strict.
--
-- To add a value later:  alter type public.goal_kind add value if not exists 'x';
--   * cannot be used in the same transaction that adds it (PostgreSQL rule);
--   * values cannot be removed, only renamed -- that is the price of the
--     better generated types, and is acceptable for sets this stable.
--   * adding a goal kind ALSO means updating public.goals' `goals_kind_fields`
--     CHECK, which deliberately rejects unknown kinds (see next migration).
-- -----------------------------------------------------------------------------

do $$ begin
  create type public.goal_kind as enum ('scheduled', 'measured', 'habit');
exception when duplicate_object then null;
end $$;

-- How large the goal's tile is drawn on the dashboard canvas: the person's own
-- statement of how much this one matters, chosen at creation and changeable.
-- An enum for the same reason as goal_kind (a real TS union downstream), and
-- the set is closed by construction -- it is a three-step scale, not a list
-- that grows. If a fourth step is ever wanted the cost is one ALTER TYPE.
do $$ begin
  create type public.goal_size as enum ('small', 'medium', 'large');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.goal_status as enum ('active', 'paused', 'completed', 'archived');
exception when duplicate_object then null;
end $$;

-- Period a habit repeats over. 'Run 3x a week' -> target_count 3, period 'week'.
do $$ begin
  create type public.habit_period as enum ('day', 'week', 'month');
exception when duplicate_object then null;
end $$;

-- Lifecycle of a single calendar occurrence.
--   planned   -> on the calendar, not yet resolved
--   completed -> counts as progress
--   skipped   -> consciously not done (still counts as "due" for adherence)
--   cancelled -> should never have existed; ignored by every progress figure
do $$ begin
  create type public.entry_status as enum ('planned', 'completed', 'skipped', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.recurrence_freq as enum ('daily', 'weekly', 'monthly');
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- Time zone helpers
--
-- A time zone cannot be validated with a CHECK constraint: looking a name up in
-- pg_timezone_names is STABLE, not IMMUTABLE. It is therefore validated by a
-- trigger on every table that stores one.
-- -----------------------------------------------------------------------------

create or replace function public.is_valid_time_zone(p_time_zone text)
returns boolean
language sql
stable
strict
set search_path = ''
as $$
  select exists (
    select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_time_zone
  );
$$;

comment on function public.is_valid_time_zone(text) is
  'True when the argument is an IANA time zone name PostgreSQL knows about.';

-- Generic: validates a `time_zone` column on any table, read from NEW via jsonb
-- so one function can serve users, recurrences and calendar_entries.
create or replace function public.validate_time_zone()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_time_zone text := to_jsonb(new) ->> 'time_zone';
begin
  if v_time_zone is not null and not public.is_valid_time_zone(v_time_zone) then
    raise exception 'invalid IANA time zone: %', v_time_zone
      using errcode = 'invalid_parameter_value';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Habit period arithmetic
--
-- STRICT on purpose: habit_period is NULL for scheduled/measured goals, so both
-- functions return NULL for them and the progress view needs no CASE guard.
-- p_week_starts_on is ISO (1 = Monday ... 7 = Sunday), stored per user.
-- -----------------------------------------------------------------------------

create or replace function public.period_start(
  p_date date,
  p_period public.habit_period,
  p_week_starts_on integer
)
returns date
language sql
immutable
strict
set search_path = ''
as $$
  select case p_period
    when 'day'   then p_date
    when 'week'  then p_date - (((extract(isodow from p_date)::int - p_week_starts_on) + 7) % 7)
    when 'month' then date_trunc('month', p_date)::date
  end;
$$;

create or replace function public.period_end(
  p_date date,
  p_period public.habit_period,
  p_week_starts_on integer
)
returns date
language sql
immutable
strict
set search_path = ''
as $$
  select case p_period
    when 'day'   then p_date
    when 'week'  then public.period_start(p_date, p_period, p_week_starts_on) + 6
    when 'month' then (date_trunc('month', p_date) + interval '1 month' - interval '1 day')::date
  end;
$$;

comment on function public.period_start(date, public.habit_period, integer) is
  'First day of the habit period containing p_date, honouring the user''s week start.';
comment on function public.period_end(date, public.habit_period, integer) is
  'Last day of the habit period containing p_date, honouring the user''s week start.';

-- -----------------------------------------------------------------------------
-- updated_at maintenance (attached BEFORE UPDATE to every table)
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
