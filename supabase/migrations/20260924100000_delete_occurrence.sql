-- =============================================================================
-- progress-tracker :: 20260924100000_delete_occurrence
--
-- 0.3.1-alpha. "I am not running this Thursday."
--
-- THE GAP THIS CLOSES. A repeat rule could be replaced or deleted whole, and a
-- completion could be taken back, but a SINGLE occurrence on a single day could
-- not be removed at all. Once a rule had materialised a day, that day was on
-- the calendar forever. There was no way to say "not this one".
--
-- WHY THE ROW IS NOT SIMPLY DELETED. Because the generator would put it back.
-- public.expand_recurrence() resumes at generated_through + 1, so a deleted
-- future day survives only until the rule is next edited: public.update_recurrence()
-- calls public.resync_recurrence(), which winds generated_through back to the
-- caller's today and re-expands to the horizon -- and a day whose row is gone
-- has nothing to conflict with, so it comes straight back. A deletion the next
-- edit undoes is worse than no feature at all, so the row STAYS, as a tombstone:
--
--   status = 'cancelled'    -- 20260916090000 already defines this as "should
--                              never have existed; ignored by every progress
--                              figure", and public.goal_progress already
--                              excludes it from planned_count and due_count.
--   is_exception = true     -- 20260916090100 already defines this as "edited
--                              away from its rule, so regenerating the series
--                              must not overwrite or delete it".
--
-- Three independent mechanisms then keep the day deleted, and each was already
-- load-bearing before this migration existed:
--
--   1. resync_recurrence() deletes only `status = 'planned'`  -> not this row.
--   2. ...and only `not is_exception`                         -> not this row.
--   3. expand_recurrence() inserts ON CONFLICT (recurrence_id, entry_date)
--      DO NOTHING, and the tombstone still occupies that pair -> the INSERT
--      that would recreate the day finds it and does nothing.
--
-- Nothing had to change in either function. The tombstone is invisible: no
-- progress figure counts it (20260916090300), GET /api/calendar does not
-- return it (backend/src/lib/calendar-entries.ts), and it occupies the row the
-- occurrence already had, so it costs the account nothing against
-- calendar_entries_per_goal.
--
-- FREEZING THE PAST DOES NOT APPLY HERE, and that is a decision, not an
-- oversight. Editing a rule is frozen at today because re-expanding ADDS days
-- to the past: "was due" grows for days already lived and session adherence
-- falls for doing nothing, which is the failure state this product does not
-- have. Deleting one occurrence can only ever REMOVE a day from that
-- denominator. Every progress figure either ignores the row already or counts
-- one fewer thing due, so:
--
--   deleting an occurrence can never lower any goal's progress_fraction.
--
-- A person removing last Thursday is correcting a plan, not rewriting history,
-- so the past is deletable and no date is refused.
--
-- A COMPLETED OCCURRENCE IS REFUSED. That one is not a plan, it is the record
-- of something somebody did, and it must not vanish through a route whose name
-- is "remove this day from my calendar". There is already an exact way to take
-- it back -- DELETE /api/goals/:id/completions/:entryId restores the status the
-- day held before, including returning a skipped day to skipped -- and after
-- that the day is deletable like any other. So: complete -> undo -> delete,
-- each step visible. A skipped occurrence IS deletable: skipping is a statement
-- about the plan, not an achievement.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- public.delete_occurrence(goal, entry) -- "not this one."
--
-- SECURITY INVOKER (the default, stated and never declared -- see the header of
-- 20260918100200). It runs as `authenticated` with the caller's JWT, so
-- calendar_entries_select/_update/_delete decide which rows exist at all.
-- Another session's occurrence is not visible to the SELECT below, so it takes
-- the same branch as an id that never existed and answers the same way.
--
-- IT TAKES NO user_id. Ownership is the caller's token, via RLS; p_goal_id is
-- the second half of the key and is there so no request body could name a goal
-- the URL does not.
--
-- HOW IT FAILS, in the fixed-token vocabulary the backend allowlists:
--   entry_not_found  -> no such entry, not this goal's, not this caller's, or
--                       already cancelled. All four are one answer on purpose;
--                       the client reads the resulting 404 as "already gone".
--   entry_completed  -> the day is completed. 409, and the copy that renders it
--                       has to stay encouraging: this is not a refusal of
--                       something they got wrong.
--
-- THE RACE, and why there is no advisory lock. The read below classifies, and
-- the write repeats the guard (`status <> 'completed'`) in its own WHERE.
-- Under READ COMMITTED an UPDATE/DELETE re-evaluates its predicate after taking
-- the row lock, so a completion that commits between the two loses the row from
-- the write's scope, FOUND is false, and the caller is told the day is
-- completed instead of having their completion quietly overwritten. That is
-- cheaper and stronger than the lock complete_occurrence() needs, which exists
-- to stop two taps INSERTING two rows -- a problem this function does not have.
-- -----------------------------------------------------------------------------
create or replace function public.delete_occurrence(p_goal_id uuid, p_entry_id uuid)
returns table (action text, id uuid, entry_date date)
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := (select public.current_user_id());
  v_entry public.calendar_entries;
  v_action text;
begin
  if v_user is null then
    raise exception 'no_identity' using errcode = 'insufficient_privilege';
  end if;

  select ce.* into v_entry
  from public.calendar_entries ce
  where ce.id = p_entry_id and ce.goal_id = p_goal_id;
  if not found then
    raise exception 'entry_not_found' using errcode = 'no_data_found';
  end if;

  -- Already a tombstone. Answering "gone" rather than "fine, again" keeps a
  -- retried delete indistinguishable from a first one, and from another
  -- session's id -- the client treats all of them as success.
  if v_entry.status = 'cancelled' then
    raise exception 'entry_not_found' using errcode = 'no_data_found';
  end if;

  if v_entry.status = 'completed' then
    -- Same errcode as wrong_goal_kind in 20260918100200: the backend classifies
    -- on the token, not the code, and this is the same class of refusal -- the
    -- request is well formed and the state is not what it needs.
    raise exception 'entry_completed' using errcode = 'invalid_parameter_value';
  end if;

  if v_entry.recurrence_id is null then
    -- No rule behind it, so nothing can regenerate it and a tombstone would be
    -- litter: a row the person cannot see, counting against their own cap.
    delete from public.calendar_entries ce
    where ce.id = v_entry.id and ce.status <> 'completed'
    returning ce.* into v_entry;
    v_action := 'deleted';
  else
    update public.calendar_entries ce
    set status = 'cancelled',
        is_exception = true
    where ce.id = v_entry.id and ce.status <> 'completed'
    returning ce.* into v_entry;
    v_action := 'cancelled';
  end if;

  if not found then
    -- Somebody completed it between the two statements. Their record wins.
    raise exception 'entry_completed' using errcode = 'invalid_parameter_value';
  end if;

  return query select v_action, v_entry.id, v_entry.entry_date;
end;
$$;

comment on function public.delete_occurrence(uuid, uuid) is
  'Removes one occurrence of a goal. An occurrence of a repeat rule is cancelled in place, which is what stops the rule regenerating that day; one with no rule is deleted outright. Refuses a completed occurrence -- undo the completion first.';

-- -----------------------------------------------------------------------------
-- Deleting a rule now sweeps its tombstones too.
--
-- Replaces the 20260918100200 version; everything else about it is unchanged.
-- A tombstone exists for exactly one reason -- to stop a rule regenerating a
-- day -- so once the rule is gone it records nothing, and the composite FK's
-- ON DELETE SET NULL would otherwise leave it behind forever as an invisible
-- row against calendar_entries_per_goal. Only 'cancelled' rows are swept, so
-- this cannot reach a completed, skipped or hand-edited occurrence, and
-- `occurrences_kept` is counted after the sweep and therefore still means what
-- it says: the history that survives the rule.
-- -----------------------------------------------------------------------------
create or replace function public.delete_recurrence(p_goal_id uuid, p_recurrence_id uuid)
returns table (id uuid, occurrences_removed integer, occurrences_kept integer)
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := (select public.current_user_id());
  v_rule public.recurrences;
  v_today date := public.current_today();
  v_removed integer := 0;
  v_kept integer := 0;
begin
  if v_user is null then
    raise exception 'no_identity' using errcode = 'insufficient_privilege';
  end if;

  select r.* into v_rule
  from public.recurrences r
  where r.id = p_recurrence_id and r.goal_id = p_goal_id;
  if not found then
    raise exception 'recurrence_not_found' using errcode = 'no_data_found';
  end if;

  delete from public.calendar_entries ce
  where ce.recurrence_id = p_recurrence_id
    and ce.status = 'planned'
    and not ce.is_exception
    and ce.entry_date > v_today;
  get diagnostics v_removed = row_count;

  -- The tombstones this rule's cancelled days left behind. Not counted in
  -- occurrences_removed: they were already removed, from the person's point of
  -- view, the day they cancelled them.
  delete from public.calendar_entries ce
  where ce.recurrence_id = p_recurrence_id
    and ce.status = 'cancelled';

  select count(*)::integer into v_kept
  from public.calendar_entries ce
  where ce.recurrence_id = p_recurrence_id;

  delete from public.recurrences r where r.id = p_recurrence_id;

  return query select p_recurrence_id, v_removed, v_kept;
end;
$$;

comment on function public.delete_recurrence(uuid, uuid) is
  'Removes a repeat rule, its future plan and the tombstones of days that were cancelled from it. Occurrences that already happened are kept, detached from the rule.';

-- -----------------------------------------------------------------------------
-- Privileges. Same argument as 20260918100200: a function that writes rows is
-- not left executable by PUBLIC, which would include anon.
-- -----------------------------------------------------------------------------
revoke execute on function public.delete_occurrence(uuid, uuid) from public;
grant execute on function public.delete_occurrence(uuid, uuid) to authenticated, service_role;
