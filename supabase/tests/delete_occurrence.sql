-- =============================================================================
-- progress-tracker :: does deleting one day stay deleted?
--
-- The one fact backend/src/routes/api-write.test.ts cannot prove, proved where
-- it lives. Every assertion below is about public.expand_recurrence() and
-- public.resync_recurrence() -- the two functions that put occurrences on the
-- calendar -- and a mocked Supabase client would happily agree with all of them
-- while the live app regenerated every day somebody deleted.
--
-- Run it against a database with migrations/ applied, as a superuser or the
-- table owner (it needs to insert an auth.users row to have an identity):
--
--   supabase db reset          # or: apply migrations/ to a throwaway database
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/delete_occurrence.sql
--
-- It ends in ROLLBACK and leaves nothing behind. Silence plus 'ALL ASSERTIONS
-- PASSED' is a pass; an ASSERT that fails names itself and aborts.
--
-- It is not wired into `npm test` on purpose: the backend suite runs in CI with
-- no database, and a test that silently skips when it cannot connect is worse
-- than one a human runs deliberately.
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

begin;

-- An account with a real identity, the way a visitor gets one.
insert into auth.users (id) values ('deadbeef-0000-4000-8000-00000000dead');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'deadbeef-0000-4000-8000-00000000dead', true);

do $$
declare
  v_goal uuid;
  v_rule uuid;
  v_future date := current_date + 7;
  v_past date := current_date - 3;
  v_entry uuid;
  v_status public.entry_status;
  v_exception boolean;
  v_linked boolean;
  v_count integer;
  v_before numeric;
  v_after numeric;
  v_due_before integer;
  v_due_after integer;
  v_action text;
begin
  -- An open-ended scheduled goal, so progress_basis is session_adherence and
  -- every occurrence is visible in due_count. Daily from a fortnight ago.
  insert into public.goals (user_id, title, kind)
  values ((select public.current_user_id()), 'Run', 'scheduled')
  returning id into v_goal;

  select r.id into v_rule
  from public.create_recurrence(v_goal, 'daily', current_date - 14) r;

  -- Two days kept, so adherence is a real fraction rather than zero.
  perform public.complete_occurrence(v_goal, current_date - 10);
  perform public.complete_occurrence(v_goal, current_date - 8);

  -- 1. Deleting a FUTURE day ---------------------------------------------------
  select ce.id into v_entry from public.calendar_entries ce where ce.entry_date = v_future;
  select d.action into v_action from public.delete_occurrence(v_goal, v_entry) d;
  assert v_action = 'cancelled', 'a day from a rule is cancelled in place, not deleted';

  select ce.status, ce.is_exception, ce.recurrence_id is not null
  into v_status, v_exception, v_linked
  from public.calendar_entries ce where ce.id = v_entry;
  assert v_status = 'cancelled', 'the tombstone carries status cancelled';
  assert v_exception, 'the tombstone carries is_exception, the second guard in resync';
  assert v_linked, 'the tombstone keeps recurrence_id: that pair is what ON CONFLICT finds';

  -- 2. THE CRUX: a full rule edit must not bring the day back ------------------
  -- update_recurrence -> resync_recurrence: delete every future planned row,
  -- wind generated_through back to today, expand the whole horizon again.
  perform public.update_recurrence(v_goal, v_rule, 'daily', current_date - 14);

  select count(*)::integer into v_count
  from public.calendar_entries ce where ce.entry_date = v_future;
  assert v_count = 1, 'the rule re-expanded a second row onto a day that was deleted';

  select ce.status into v_status
  from public.calendar_entries ce where ce.entry_date = v_future;
  assert v_status = 'cancelled', 'the deleted day came back as planned after a rule edit';

  -- 3. ...and neither must a bare expansion over the same horizon --------------
  update public.recurrences r set generated_through = current_date where r.id = v_rule;
  perform public.expand_recurrence(v_rule, current_date + 90);

  select count(*)::integer into v_count
  from public.calendar_entries ce where ce.entry_date = v_future and ce.status <> 'cancelled';
  assert v_count = 0, 'expand_recurrence resurrected a deleted day';

  -- 4. Deleting it again is "already gone", not an error to the client ---------
  begin
    perform public.delete_occurrence(v_goal, v_entry);
    assert false, 'deleting an already-cancelled day should raise entry_not_found';
  exception when no_data_found then
    assert sqlerrm = 'entry_not_found', 'the token must stay entry_not_found';
  end;

  -- 5. A PAST planned day is deletable, and progress cannot fall ---------------
  select gp.progress_fraction, gp.due_count into v_before, v_due_before
  from public.goal_progress gp where gp.goal_id = v_goal;

  select ce.id into v_entry from public.calendar_entries ce where ce.entry_date = v_past;
  perform public.delete_occurrence(v_goal, v_entry);

  select gp.progress_fraction, gp.due_count into v_after, v_due_after
  from public.goal_progress gp where gp.goal_id = v_goal;
  assert v_due_after = v_due_before - 1, 'a deleted past day must leave due_count';
  assert v_after >= v_before,
    'deleting an occurrence lowered progress -- the invariant the freeze rule exists for';

  -- 6. A COMPLETED day is refused, and survives the attempt --------------------
  select ce.id into v_entry
  from public.calendar_entries ce where ce.entry_date = current_date - 10;
  begin
    perform public.delete_occurrence(v_goal, v_entry);
    assert false, 'deleting a completed day should raise entry_completed';
  exception when invalid_parameter_value then
    assert sqlerrm = 'entry_completed', 'the token must stay entry_completed';
  end;

  select ce.status into v_status from public.calendar_entries ce where ce.id = v_entry;
  assert v_status = 'completed', 'the refused day must be untouched';

  -- 7. ...and undo is the documented way back: undo, then delete ---------------
  perform public.undo_occurrence(v_goal, v_entry);
  select d.action into v_action from public.delete_occurrence(v_goal, v_entry) d;
  assert v_action = 'cancelled', 'once taken back, the day deletes like any other';

  -- 8. Dropping the rule sweeps the tombstones it left behind ------------------
  select count(*)::integer into v_count
  from public.calendar_entries ce where ce.status = 'cancelled';
  assert v_count = 3, 'expected three tombstones before the rule is deleted';

  perform public.delete_recurrence(v_goal, v_rule);

  select count(*)::integer into v_count
  from public.calendar_entries ce where ce.status = 'cancelled';
  assert v_count = 0, 'deleting the rule must sweep its tombstones: nothing can regenerate them';

  -- ...while every completed day survives, detached from the rule.
  select count(*)::integer into v_count
  from public.calendar_entries ce where ce.status = 'completed';
  assert v_count = 1, 'a completed session must survive its rule being deleted';

  raise notice 'ALL ASSERTIONS PASSED';
end $$;

-- 9. Another session sees none of it, and is told nothing about it ------------
reset role;
insert into auth.users (id) values ('deadbeef-0000-4000-8000-00000000beef');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'deadbeef-0000-4000-8000-00000000beef', true);

do $$
declare
  v_count integer;
begin
  select count(*)::integer into v_count from public.calendar_entries;
  assert v_count = 0, 'another session can see the first one''s calendar';

  begin
    perform public.delete_occurrence(
      '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000');
    assert false, 'expected entry_not_found';
  exception when no_data_found then
    -- The same token, and therefore the same 404, as an id that never existed.
    assert sqlerrm = 'entry_not_found', 'another session must get the ordinary not-found token';
  end;

  raise notice 'ISOLATION ASSERTIONS PASSED';
end $$;

rollback;
