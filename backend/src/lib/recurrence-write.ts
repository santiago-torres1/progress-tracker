import { toRecurrence } from './recurrences.js';
import { readInteger, readString, type UnknownRow } from './row.js';
import type { SupabaseUserClient } from './supabase.js';
import { requireRow, runWrite } from './write.js';
import type { OccurrenceChange, Recurrence, RecurrenceInput } from '../types/api.js';

/*
 * Repeat rules, and the occurrences they materialise.
 *
 * The schema stores the rule AND the rows: a calendar range stays one index scan, and
 * per-occurrence state (completed, skipped, moved) has somewhere to live. The price is that the
 * two can fall out of step, and keeping them in step is what these three calls are for.
 *
 * All three are RPCs because all three are several statements that must not half-happen. Editing
 * a rule is: drop the future plan, reset the horizon, expand again — and a client that saw the
 * first statement land and the third not would have a goal with no upcoming sessions.
 *
 * WHAT SURVIVES AN EDIT. Only future, planned, non-exception occurrences are dropped. A completed
 * session is history and is never touched; a skipped one is a decision somebody made; one dragged
 * to another time carries is_exception and is left alone. Ad-hoc completions have no recurrence_id
 * at all, so they are outside the whole operation. The numbers in `occurrences` say what moved.
 *
 * AND NOTHING IS ADDED TO THE PAST EITHER. Re-expansion resumes the day after the caller's own
 * today (SQL sets generated_through to that date rather than clearing it), so moving a goal from
 * Tue/Thu to Mon/Wed/Fri does not materialise Mondays that have already gone by. It would
 * otherwise raise due_count — the denominator of session adherence — for days already lived, and
 * an app with no failure states must not quietly decide somebody was behind on a day they never
 * planned. `occurrences.created` therefore counts future rows only.
 */

const CONTEXT = '[api/goals/recurrences]';

/*
 * A rule's row shape is mapped by lib/recurrences.ts and imported here, the same way
 * occurrence-write.ts borrows toCalendarEntry from calendar-entries.ts: what a write returns and
 * what a read returns are the same rule, so there is one mapper for both.
 */

function toChange(row: UnknownRow): OccurrenceChange {
  return {
    removed: readInteger(row, 'occurrences_removed'),
    created: readInteger(row, 'occurrences_created'),
  };
}

export interface RecurrenceResult {
  recurrence: Recurrence;
  occurrences: OccurrenceChange;
}

/** The arguments both write RPCs take, from an already-validated rule. */
function ruleArgs(input: RecurrenceInput): Record<string, unknown> {
  return {
    p_freq: input.freq,
    p_start_date: input.startDate,
    p_interval_count: input.interval ?? 1,
    p_byweekday: input.byWeekday ?? null,
    p_until_date: input.untilDate ?? null,
    p_start_time: input.startTime ?? null,
    p_end_time: input.endTime ?? null,
    // Null means "the caller's own zone", which SQL resolves from their profile. A rule means
    // nothing without a zone, and the browser's guess is not better than the one they set.
    p_time_zone: input.timeZone ?? null,
  };
}

/** Adds a rule to a goal and materialises it to the horizon, in one transaction. */
export async function createRecurrence(
  client: SupabaseUserClient,
  goalId: string,
  input: RecurrenceInput,
  timeoutMs?: number,
): Promise<RecurrenceResult> {
  const rows = await runWrite(
    (signal) =>
      client
        .rpc('create_recurrence', { p_goal_id: goalId, ...ruleArgs(input) })
        .abortSignal(signal),
    CONTEXT,
    timeoutMs,
  );

  const row = requireRow(rows, 'goal');
  return { recurrence: toRecurrence(row), occurrences: toChange(row) };
}

/**
 * Replaces a rule whole and re-materialises it.
 *
 * `isActive: false` is how a rule is paused: the future plan is dropped and nothing new is
 * generated, while every occurrence that already happened stays exactly where it is.
 */
export async function updateRecurrence(
  client: SupabaseUserClient,
  goalId: string,
  recurrenceId: string,
  input: RecurrenceInput,
  timeoutMs?: number,
): Promise<RecurrenceResult> {
  const rows = await runWrite(
    (signal) =>
      client
        .rpc('update_recurrence', {
          p_goal_id: goalId,
          p_recurrence_id: recurrenceId,
          ...ruleArgs(input),
          p_is_active: input.isActive ?? true,
        })
        .abortSignal(signal),
    CONTEXT,
    timeoutMs,
  );

  const row = requireRow(rows, 'recurrence');
  return { recurrence: toRecurrence(row), occurrences: toChange(row) };
}

export interface DeleteRecurrenceResult {
  id: string;
  removed: number;
  kept: number;
}

/**
 * Removes a rule and its future plan.
 *
 * Occurrences that already happened are kept and detached — the composite foreign key is
 * ON DELETE SET NULL (recurrence_id) — because the progress they record is a fact, and deleting
 * the plan they came from does not unmake it. `kept` counts them.
 */
export async function deleteRecurrence(
  client: SupabaseUserClient,
  goalId: string,
  recurrenceId: string,
  timeoutMs?: number,
): Promise<DeleteRecurrenceResult> {
  const rows = await runWrite(
    (signal) =>
      client
        .rpc('delete_recurrence', { p_goal_id: goalId, p_recurrence_id: recurrenceId })
        .abortSignal(signal),
    CONTEXT,
    timeoutMs,
  );

  const row = requireRow(rows, 'recurrence');
  return {
    id: readString(row, 'id'),
    removed: readInteger(row, 'occurrences_removed'),
    kept: readInteger(row, 'occurrences_kept'),
  };
}
