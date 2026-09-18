-- =============================================================================
-- progress-tracker :: 20260918100100_write_state
--
-- 0.2.0-alpha Phase 2. The state the write paths need before they can be
-- written: three small schema facts, each of which exists because a route
-- handler could not supply it honestly.
--
--   1 + 2. Two columns on calendar_entries that make UNDO EXACT.
--   3.     One unique index that makes LOGGING A MEASUREMENT IDEMPOTENT.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 + 2. Undo has to restore what was there, not something that looks like it.
--
-- "Tapping again takes it back" is a product requirement, and taking it back
-- means two different things:
--
--   * The occurrence already existed -- a session materialised from a rule, or
--     a day the person had planned. Undo puts its previous status back.
--   * There was no occurrence at all. "I ran today" on a day the rule never
--     named creates the row, so undo has to DELETE it. Leaving a planned
--     occurrence behind would be a plan the person never made: harmless-looking
--     on a habit, but it moves planned_count and due_count on a scheduled goal,
--     which is the denominator of session_adherence. Undo would quietly change
--     the number it was supposed to restore.
--
-- Neither fact is derivable after the event. `recurrence_id IS NULL` does not
-- mean "we created it" (a one-off entry the person made themselves looks
-- identical), and assuming 'planned' as the previous status is wrong for an
-- occurrence that had been skipped. The alternative -- have the client send
-- back what the state used to be -- was rejected: it is the caller's word for
-- something the database already knows, and it is lost the moment the page is
-- reloaded between the tap and the untap.
--
-- So the two facts are stored, and they are small: a boolean and a nullable
-- enum, both NULL/false for every row that exists today.
-- -----------------------------------------------------------------------------

alter table public.calendar_entries
  add column if not exists created_by_completion boolean not null default false;

alter table public.calendar_entries
  add column if not exists pre_completion_status public.entry_status;

comment on column public.calendar_entries.created_by_completion is
  'True when this row exists only because the person recorded a completion on a day that had no occurrence. Undoing that completion deletes the row again. Provenance: set once, at insert.';
comment on column public.calendar_entries.pre_completion_status is
  'The status this occurrence had before it was completed, so undo restores it exactly. NULL on a row that was not completed, and on one that was created by the completion itself.';

-- The stamp is only meaningful while the entry is completed, exactly like
-- completed_at. The trigger below clears it otherwise, so this can never be
-- stale; the constraint is what stops a direct write leaving it that way.
do $$ begin
  alter table public.calendar_entries
    add constraint calendar_entries_pre_completion_status_matches_status
    check (pre_completion_status is null or status = 'completed');
exception when duplicate_object then null;
end $$;

-- A row created by a completion is completed by definition, and it is never a
-- materialised occurrence of a rule -- expand_recurrence() only ever inserts
-- planned rows, and only ever with a recurrence_id.
do $$ begin
  alter table public.calendar_entries
    add constraint calendar_entries_created_by_completion_shape
    check (not created_by_completion or recurrence_id is null);
exception when duplicate_object then null;
end $$;

-- Replaces the 20260916090200 version. Everything it did is unchanged -- the
-- inherited time zone, the derived entry_date, completed_at in step with status
-- -- with one clause added: pre_completion_status follows completed_at, so a
-- status change away from 'completed' cannot leave a restore-point behind.
-- (CREATE OR REPLACE FUNCTION, not a new trigger: the trigger in 20260916090200
-- already points here, and two triggers writing the same columns would be a
-- firing-order puzzle for no gain.)
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
    -- The restore point belongs to the completion that is being undone. Once
    -- the entry is not completed there is nothing left to restore.
    new.pre_completion_status := null;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. One check-in per goal per day.
--
-- A measured goal stores an ABSOLUTE value ("81.6 kg", "2,750 saved"), not an
-- increment, and public.goal_progress reads the latest one. So two check-ins
-- for the same goal on the same day are not two facts -- the second is a
-- correction of the first, and keeping both leaves a row nobody will ever read
-- again counting against progress_entries_per_goal.
--
-- Making that a unique index is what lets "log today's number" be an UPSERT,
-- and therefore idempotent: a double-tapped save, or a request the client
-- retried because the response was lost, writes the same row twice and leaves
-- one. Without it the retry silently doubles the row count with no visible
-- effect on the dashboard, which is the worst of both.
--
-- It costs the ability to store two weigh-ins in one day, which the product
-- has no way to ask for and no way to display. (Repetition is a different
-- table: two runs on one day are two calendar_entries, and that is deliberately
-- still allowed -- see the partial unique index in 20260916090200.)
-- -----------------------------------------------------------------------------
create unique index if not exists progress_entries_goal_day_uidx
  on public.progress_entries (goal_id, occurred_on);

comment on index public.progress_entries_goal_day_uidx is
  'One check-in per goal per day: the value ON a day. Also the conflict target that makes logging a measurement idempotent.';

-- -----------------------------------------------------------------------------
-- How far ahead a rule is materialised, in one place.
--
-- The write routes re-expand a rule whenever it changes, and a horizon job will
-- extend it later; both have to agree on what "keep the calendar populated"
-- means, and a second copy of 90 in TypeScript is how they would stop agreeing.
-- Same reasoning as public.anonymous_retention() and public.usage_limit().
-- -----------------------------------------------------------------------------
create or replace function public.recurrence_horizon_days()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 90;
$$;

comment on function public.recurrence_horizon_days() is
  'Days past today that a recurrence is materialised for. A rule with no end date is only real as far as it has been expanded.';

grant execute on function public.recurrence_horizon_days() to authenticated, service_role;
