-- =============================================================================
-- progress-tracker :: 20260916090200_indexes_and_triggers
--
-- Indexes sized for the queries the app actually runs, the triggers that keep
-- derived columns honest, and public.expand_recurrence() -- the function that
-- turns a repeat rule into real calendar rows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------

-- At most one login-less default user.
create unique index if not exists users_single_default_uidx
  on public.users (is_default) where is_default;

-- Built-in areas are unique by slug; each user's own areas are unique per user.
create unique index if not exists life_areas_system_slug_uidx
  on public.life_areas (slug) where user_id is null;
create unique index if not exists life_areas_user_slug_uidx
  on public.life_areas (user_id, slug) where user_id is not null;
create index if not exists life_areas_user_sort_idx
  on public.life_areas (user_id, sort_order, name);

-- The dashboard query: a user's active goals in display order.
create index if not exists goals_dashboard_idx
  on public.goals (user_id, sort_order, created_at) where status = 'active';
create index if not exists goals_user_status_idx
  on public.goals (user_id, status);
create index if not exists goals_life_area_idx
  on public.goals (life_area_id) where life_area_id is not null;

create index if not exists recurrences_goal_idx
  on public.recurrences (goal_id);
-- "Which active rules need more occurrences materialised?" for the horizon job.
create index if not exists recurrences_horizon_idx
  on public.recurrences (generated_through) where is_active;

-- The calendar view: every entry, timed or not, in a date range.
create index if not exists calendar_entries_user_date_idx
  on public.calendar_entries (user_id, entry_date, start_at);
create index if not exists calendar_entries_goal_date_idx
  on public.calendar_entries (goal_id, entry_date) where goal_id is not null;
-- Progress counting and "last time I did this".
create index if not exists calendar_entries_goal_completed_idx
  on public.calendar_entries (goal_id, entry_date desc)
  where status = 'completed' and goal_id is not null;
-- One occurrence per rule per day: makes expansion idempotent (ON CONFLICT).
create unique index if not exists calendar_entries_recurrence_day_uidx
  on public.calendar_entries (recurrence_id, entry_date) where recurrence_id is not null;

-- Latest check-in per goal (DISTINCT ON in public.goal_progress).
create index if not exists progress_entries_goal_recent_idx
  on public.progress_entries (goal_id, occurred_on desc, created_at desc);
create index if not exists progress_entries_user_date_idx
  on public.progress_entries (user_id, occurred_on desc);

-- -----------------------------------------------------------------------------
-- Table-dependent trigger functions
-- -----------------------------------------------------------------------------

-- Applies the habit minimum default, and keeps goals.completed_at /
-- archived_at in step with goals.status -- which is what lets the CHECK
-- constraints above be strict without the API having to set stamps by hand.
create or replace function public.goals_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prev_completed_at timestamptz;
  v_prev_archived_at timestamptz;
begin
  -- minimum_count "defaults to 1" HERE and not as a column DEFAULT, because a
  -- column default applies to every kind: a measured goal inserted without
  -- mentioning minimum_count would silently get 1 and then fail
  -- goals_kind_fields, which requires NULL off habits. Defaulting only for
  -- habits keeps `insert ... kind = 'habit', target_count = 4` valid while a
  -- minimum_count on a non-habit still raises, which is the tripwire we want.
  if new.kind = 'habit' then
    new.minimum_count := coalesce(new.minimum_count, 1);
  end if;

  -- OLD is not available on INSERT; branch rather than touch it.
  if tg_op = 'UPDATE' then
    v_prev_completed_at := old.completed_at;
    v_prev_archived_at := old.archived_at;
  end if;

  if new.status = 'archived' then
    new.archived_at := coalesce(new.archived_at, v_prev_archived_at, now());
    -- Filing a finished goal away must not erase when it was finished.
    new.completed_at := coalesce(new.completed_at, v_prev_completed_at);
  else
    new.archived_at := null;
    if new.status = 'completed' then
      new.completed_at := coalesce(new.completed_at, v_prev_completed_at, now());
    else
      new.completed_at := null;
    end if;
  end if;

  return new;
end;
$$;

-- Fills the time zone from the owning rule or user, derives entry_date for
-- timed entries, and keeps completed_at in step with status.
create or replace function public.calendar_entries_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.time_zone is null and new.recurrence_id is not null then
    select r.time_zone into new.time_zone
    from public.recurrences r
    where r.id = new.recurrence_id;
  end if;

  if new.time_zone is null then
    select u.time_zone into new.time_zone
    from public.users u
    where u.id = new.user_id;
  end if;

  -- Derived, never supplied: the denormalised day cannot drift from the instant.
  if new.start_at is not null and new.time_zone is not null then
    new.entry_date := (new.start_at at time zone new.time_zone)::date;
  end if;

  if new.status = 'completed' then
    if tg_op = 'UPDATE' then
      new.completed_at := coalesce(new.completed_at, old.completed_at, now());
    else
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Triggers
--
-- PostgreSQL fires BEFORE triggers in name order. On calendar_entries
-- 'calendar_entries_before_write' must run before
-- 'calendar_entries_validate_time_zone' (it is what fills the inherited zone in)
-- -- 'b' < 'v' gets that for free; keep it in mind if these are ever renamed.
-- -----------------------------------------------------------------------------

create or replace trigger users_validate_time_zone
  before insert or update on public.users
  for each row execute function public.validate_time_zone();
create or replace trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create or replace trigger life_areas_set_updated_at
  before update on public.life_areas
  for each row execute function public.set_updated_at();

create or replace trigger goals_before_write
  before insert or update on public.goals
  for each row execute function public.goals_before_write();
create or replace trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

create or replace trigger recurrences_validate_time_zone
  before insert or update on public.recurrences
  for each row execute function public.validate_time_zone();
create or replace trigger recurrences_set_updated_at
  before update on public.recurrences
  for each row execute function public.set_updated_at();

create or replace trigger calendar_entries_before_write
  before insert or update on public.calendar_entries
  for each row execute function public.calendar_entries_before_write();
create or replace trigger calendar_entries_validate_time_zone
  before insert or update on public.calendar_entries
  for each row execute function public.validate_time_zone();
create or replace trigger calendar_entries_set_updated_at
  before update on public.calendar_entries
  for each row execute function public.set_updated_at();

create or replace trigger progress_entries_set_updated_at
  before update on public.progress_entries
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- public.expand_recurrence(rule, through)
--
-- Materialises a rule's occurrences as calendar_entries up to `p_through`.
-- Chosen over computing occurrences on read because per-occurrence state
-- (completed / skipped / moved) has to live somewhere anyway, and a calendar
-- range query then stays an index scan instead of a set-returning computation.
--
-- Safe to call repeatedly: it never touches an existing row (ON CONFLICT DO
-- NOTHING on the one-per-rule-per-day unique index), so a completed or edited
-- occurrence always survives re-expansion.
--
-- It also never touches AD-HOC entries. This function only ever INSERTs, and
-- only ever with recurrence_id = r.id, so an unplanned completion (a run on a
-- day the rule never named, recurrence_id IS NULL) cannot be overwritten,
-- deleted or deduplicated away by expansion. That is load-bearing: unplanned
-- completions count towards a habit period exactly like planned ones.
--
-- SECURITY INVOKER: the caller's RLS applies, so this cannot be used to write
-- into somebody else's calendar.
-- -----------------------------------------------------------------------------
create or replace function public.expand_recurrence(p_recurrence_id uuid, p_through date)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r public.recurrences%rowtype;
  v_from date;
  v_to date;
  v_inserted integer := 0;
begin
  select * into r from public.recurrences where id = p_recurrence_id;
  if not found then
    raise exception 'recurrence % not found', p_recurrence_id using errcode = 'no_data_found';
  end if;
  if not r.is_active then
    return 0;
  end if;

  -- Resume where the last expansion stopped; never regenerate the past.
  v_from := greatest(r.start_date, coalesce(r.generated_through + 1, r.start_date));
  v_to := least(p_through, coalesce(r.until_date, p_through));
  if v_to < v_from then
    return 0;
  end if;

  insert into public.calendar_entries (
    user_id, goal_id, recurrence_id, entry_date, start_at, end_at, time_zone, status
  )
  select
    r.user_id,
    r.goal_id,
    r.id,
    d::date,
    case when r.start_time is null then null
         else (d::date + r.start_time) at time zone r.time_zone end,
    case when r.end_time is null then null
         else (d::date + r.end_time) at time zone r.time_zone end,
    r.time_zone,
    'planned'
  from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') as g(d)
  where
    case r.freq
      when 'daily' then
        (d::date - r.start_date) % r.interval_count = 0
      when 'weekly' then
        extract(isodow from d)::smallint = any (r.byweekday)
        and (
          (public.period_start(d::date, 'week'::public.habit_period, 1)
           - public.period_start(r.start_date, 'week'::public.habit_period, 1)) / 7
        ) % r.interval_count = 0
      when 'monthly' then
        extract(day from d)::int = extract(day from r.start_date)::int
        and (
          (extract(year from d)::int - extract(year from r.start_date)::int) * 12
          + (extract(month from d)::int - extract(month from r.start_date)::int)
        ) % r.interval_count = 0
    end
  on conflict (recurrence_id, entry_date) where recurrence_id is not null do nothing;

  get diagnostics v_inserted = row_count;

  update public.recurrences
  set generated_through = greatest(coalesce(generated_through, v_to), v_to)
  where id = r.id;

  return v_inserted;
end;
$$;

comment on function public.expand_recurrence(uuid, date) is
  'Materialise a recurrence into calendar_entries through the given date. Idempotent; never overwrites an existing occurrence.';
