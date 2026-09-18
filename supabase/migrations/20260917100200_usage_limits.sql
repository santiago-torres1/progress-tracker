-- =============================================================================
-- progress-tracker :: 20260917100200_usage_limits
--
-- The API is open: anyone with the URL gets an anonymous account and can write.
-- Limits therefore live HERE, where a route handler that forgets to check
-- cannot bypass them, rather than in TypeScript. Phase 2's write routes inherit
-- all of this for free and should not re-implement any of it.
--
-- Two mechanisms, chosen per problem:
--
--   * Free-text length -> CHECK constraints. A CHECK is evaluated per row with
--     no lookups, cannot be turned off, and names itself in the error.
--   * Row counts -> triggers. A CHECK cannot contain a subquery, so "at most N
--     goals per user" has to be a trigger. They are AFTER ... FOR EACH
--     STATEMENT with a transition table, not FOR EACH ROW: expanding a
--     recurrence inserts ~90 rows in one statement, and a per-row trigger would
--     run 90 counts to answer one question.
--
-- The numbers are meant to be invisible to a real person and expensive for a
-- script. See public.usage_limit() for each one and why.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The numbers, in exactly one place.
--
-- IMMUTABLE and readable by any session, so the UI (and a test) can ask what
-- the cap is instead of hardcoding a second copy that drifts.
--
-- Unknown names return NULL on purpose: public.raise_limit_reached() treats a
-- NULL limit as a programming error and raises, so a typo in a trigger fails
-- loudly rather than silently disabling a cap.
-- -----------------------------------------------------------------------------
create or replace function public.usage_limit(p_name text)
returns integer
language sql
immutable
strict
set search_path = ''
as $$
  select case p_name
    -- Every goal the account holds, archived and completed included: the cap
    -- bounds stored rows, and archiving is the app's non-destructive "delete",
    -- so it has to count. A person with 100 goals on one board has a different
    -- problem from the one this app solves.
    when 'goals_per_user' then 100

    -- ~2 years of a daily habit, materialised. The 0.1.1 demo's busiest goal
    -- holds about 50. A 90-day session cannot reach this by using the app; a
    -- script can, and stops here.
    when 'calendar_entries_per_goal' then 750

    -- Plain calendar items (dentist, birthday) have no goal, so the per-goal
    -- cap does not see them. Without this the per-goal cap is one NULL away
    -- from being bypassed entirely.
    when 'calendar_entries_without_goal_per_user' then 750

    -- ~2 years of a daily weigh-in on a single goal.
    when 'progress_entries_per_goal' then 750

    -- Repeat rules multiply into calendar rows, so this is the cheapest cap to
    -- enforce and the most valuable. Ten rules on one goal is already beyond
    -- anything the UI can express.
    when 'recurrences_per_goal' then 10

    -- Custom life areas are a later release; the RLS policy already allows
    -- them, so the cap exists before the feature does.
    when 'life_areas_per_user' then 20
  end;
$$;

comment on function public.usage_limit(text) is
  'The per-account storage caps, by name. NULL for an unknown name, which callers must treat as an error.';

grant execute on function public.usage_limit(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The one way a cap says no.
--
-- The message is a fixed machine token and DETAIL names the cap. Neither
-- carries a row, an id, a count or anything the caller supplied, so nothing
-- here can leak one account's shape to another. errcode 23514 (check_violation)
-- puts it in the integrity-violation class, which PostgREST renders as HTTP
-- 400 rather than a 500 that looks like a crash.
-- -----------------------------------------------------------------------------
create or replace function public.raise_limit_reached(p_limit_name text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'limit_reached'
    using errcode = 'check_violation',
          detail = p_limit_name,
          hint = 'This account has reached a built-in limit. Remove something before adding more.';
end;
$$;

-- -----------------------------------------------------------------------------
-- Free-text length.
--
-- Bounded at the column so no route can store an unbounded blob. Every bound is
-- generous for prose a person would actually type. goals.title was already
-- capped at 200 by goals_title_not_blank in 20260916090100.
--
-- CHECK has no IF NOT EXISTS, so each is wrapped for re-runnability.
-- -----------------------------------------------------------------------------
do $$ begin
  alter table public.users
    add constraint users_display_name_length check (length(display_name) <= 80);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.life_areas
    add constraint life_areas_name_length check (length(name) <= 60);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.goals
    add constraint goals_description_length
    check (description is null or length(description) <= 2000);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.calendar_entries
    add constraint calendar_entries_title_length
    check (title is null or length(title) <= 200);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.calendar_entries
    add constraint calendar_entries_notes_length
    check (notes is null or length(notes) <= 2000);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.progress_entries
    add constraint progress_entries_note_length
    check (note is null or length(note) <= 1000);
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- Row-count caps.
--
-- Each trigger takes a transaction-scoped advisory lock on the scope it is
-- about to count, BEFORE counting. That is what makes the cap exact rather than
-- approximate under concurrency: under READ COMMITTED (what PostgREST uses)
-- every statement takes a fresh snapshot, so a transaction that waits on the
-- lock and then counts sees the rows the transaction ahead of it committed.
-- Without the lock, two concurrent inserts at the cap would each count N-1 and
-- both succeed. The lock key is (a constant per table, hash of the scope id),
-- so it only ever serialises writes to the same user's or the same goal's rows.
--
-- AFTER, not BEFORE: the count then includes the rows being written, so the
-- test is simply "is the resulting state over the cap". Raising rolls the
-- statement back.
--
-- ON INSERT ONLY, deliberately. These caps exist to bound how many rows an
-- account can store, and no UPDATE can increase a row count -- it can only move
-- an existing row between two scopes the same person already owns (RLS and the
-- composite (id, user_id) foreign keys make moving one across an account
-- boundary impossible). So the total stays bounded without an UPDATE trigger;
-- the most an UPDATE can do is leave one goal temporarily over its share, which
-- the next INSERT into that goal refuses and thereby heals.
-- The alternative is not free: PostgreSQL rejects a transition table on a
-- trigger that has a column list, so an UPDATE trigger here would have to fire
-- on EVERY update -- including the single hottest write in the app, marking a
-- calendar entry complete -- to defend an invariant that is not a safety
-- property.
-- -----------------------------------------------------------------------------

create or replace function public.goals_enforce_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_limit integer := public.usage_limit('goals_per_user');
  v_user uuid;
  v_count bigint;
begin
  for v_user in select distinct n.user_id from new_rows n loop
    perform pg_catalog.pg_advisory_xact_lock(1001, pg_catalog.hashtext(v_user::text));
    select count(*) into v_count from public.goals g where g.user_id = v_user;
    if v_limit is null or v_count > v_limit then
      perform public.raise_limit_reached('goals_per_user');
    end if;
  end loop;
  return null;
end;
$$;

create or replace trigger goals_enforce_limits
  after insert on public.goals
  referencing new table as new_rows
  for each statement execute function public.goals_enforce_limits();

create or replace function public.recurrences_enforce_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_limit integer := public.usage_limit('recurrences_per_goal');
  v_goal uuid;
  v_count bigint;
begin
  for v_goal in select distinct n.goal_id from new_rows n loop
    perform pg_catalog.pg_advisory_xact_lock(1002, pg_catalog.hashtext(v_goal::text));
    select count(*) into v_count from public.recurrences r where r.goal_id = v_goal;
    if v_limit is null or v_count > v_limit then
      perform public.raise_limit_reached('recurrences_per_goal');
    end if;
  end loop;
  return null;
end;
$$;

create or replace trigger recurrences_enforce_limits
  after insert on public.recurrences
  referencing new table as new_rows
  for each statement execute function public.recurrences_enforce_limits();

-- Two scopes in one trigger: goal-linked entries are capped per goal, and
-- goal-less ones (which no per-goal cap can see) per user.
create or replace function public.calendar_entries_enforce_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_goal_limit integer := public.usage_limit('calendar_entries_per_goal');
  v_loose_limit integer := public.usage_limit('calendar_entries_without_goal_per_user');
  v_goal uuid;
  v_user uuid;
  v_count bigint;
begin
  for v_goal in select distinct n.goal_id from new_rows n where n.goal_id is not null loop
    perform pg_catalog.pg_advisory_xact_lock(1003, pg_catalog.hashtext(v_goal::text));
    select count(*) into v_count
    from public.calendar_entries ce
    where ce.goal_id = v_goal;
    if v_goal_limit is null or v_count > v_goal_limit then
      perform public.raise_limit_reached('calendar_entries_per_goal');
    end if;
  end loop;

  for v_user in select distinct n.user_id from new_rows n where n.goal_id is null loop
    perform pg_catalog.pg_advisory_xact_lock(1004, pg_catalog.hashtext(v_user::text));
    select count(*) into v_count
    from public.calendar_entries ce
    where ce.user_id = v_user and ce.goal_id is null;
    if v_loose_limit is null or v_count > v_loose_limit then
      perform public.raise_limit_reached('calendar_entries_without_goal_per_user');
    end if;
  end loop;

  return null;
end;
$$;

create or replace trigger calendar_entries_enforce_limits
  after insert on public.calendar_entries
  referencing new table as new_rows
  for each statement execute function public.calendar_entries_enforce_limits();

create or replace function public.progress_entries_enforce_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_limit integer := public.usage_limit('progress_entries_per_goal');
  v_goal uuid;
  v_count bigint;
begin
  for v_goal in select distinct n.goal_id from new_rows n loop
    perform pg_catalog.pg_advisory_xact_lock(1005, pg_catalog.hashtext(v_goal::text));
    select count(*) into v_count from public.progress_entries pe where pe.goal_id = v_goal;
    if v_limit is null or v_count > v_limit then
      perform public.raise_limit_reached('progress_entries_per_goal');
    end if;
  end loop;
  return null;
end;
$$;

create or replace trigger progress_entries_enforce_limits
  after insert on public.progress_entries
  referencing new table as new_rows
  for each statement execute function public.progress_entries_enforce_limits();

-- Built-in areas (user_id IS NULL) are reference data inserted by migration and
-- are deliberately outside the cap.
create or replace function public.life_areas_enforce_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_limit integer := public.usage_limit('life_areas_per_user');
  v_user uuid;
  v_count bigint;
begin
  for v_user in select distinct n.user_id from new_rows n where n.user_id is not null loop
    perform pg_catalog.pg_advisory_xact_lock(1006, pg_catalog.hashtext(v_user::text));
    select count(*) into v_count from public.life_areas la where la.user_id = v_user;
    if v_limit is null or v_count > v_limit then
      perform public.raise_limit_reached('life_areas_per_user');
    end if;
  end loop;
  return null;
end;
$$;

create or replace trigger life_areas_enforce_limits
  after insert on public.life_areas
  referencing new table as new_rows
  for each statement execute function public.life_areas_enforce_limits();
