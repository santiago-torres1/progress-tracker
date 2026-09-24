import { toCalendarEntry } from './calendar-entries.js';
import { readBoolean, readEnum, readString, type UnknownRow } from './row.js';
import type { SupabaseUserClient } from './supabase.js';
import { requireRow, runWrite } from './write.js';
import type { CalendarEntry, CalendarEntryGoal, GoalSummary } from '../types/api.js';

/*
 * "I did it", and "no, take that back".
 *
 * Both are one RPC each, because both are a decision plus a write and neither is safe as two
 * round trips. Completing today has to find out whether the day already holds an occurrence and
 * create one if not; undoing has to know whether the occurrence pre-existed. Splitting either
 * across two requests would race with the second tap of a double tap.
 *
 * The decisions themselves live in SQL (supabase/migrations/20260918100200) rather than here, and
 * that is the point: they read and write rows under the caller's own row-level security inside a
 * single transaction, so nothing between the decision and the write can change the answer.
 */

const CONTEXT = '[api/goals/completions]';

/** Context for the one call in this file that is not about completing. */
const DELETE_CONTEXT = '[api/goals/occurrences]';

/** `restored` puts a status back, `deleted` removes a row the completion created, `noop` is a retry. */
export type UndoAction = 'restored' | 'deleted' | 'noop';

const UNDO_ACTIONS = ['restored', 'deleted', 'noop'] as const;

/** `cancelled` tombstones an occurrence of a rule; `deleted` removes one that had no rule. */
export type DeleteOccurrenceAction = 'cancelled' | 'deleted';

const DELETE_ACTIONS = ['cancelled', 'deleted'] as const;

export interface CompletionResult {
  /** True when the day held no occurrence and one was created to record this. */
  created: boolean;
  /** The occurrence, still as a row: the route shapes it once it has re-read the tile. */
  row: UnknownRow;
}

export interface UndoResult {
  action: UndoAction;
  /** On `deleted`, the row as it was — enough for a client to remove it from a calendar. */
  row: UnknownRow;
}

export interface DeleteOccurrenceResult {
  action: DeleteOccurrenceAction;
  /** The occurrence that is now gone. The client removes this id from the calendar it holds. */
  id: string;
}

/**
 * Shapes the RPC's row as the calendar's own type.
 *
 * The functions return the same columns GET /api/calendar selects, so the client gets an entry
 * identical in shape to the ones it is already holding — including the "NULL title means show the
 * goal's title" fallback, which toCalendarEntry() resolves in the one place it lives.
 *
 * The goal is passed in rather than fetched: the route reads the tile once after the write and
 * uses it for both halves of the response, which keeps a completion at two round trips.
 */
export function toEntry(row: UnknownRow, goal: CalendarEntryGoal): CalendarEntry {
  return toCalendarEntry(row, new Map([[goal.id, goal]]));
}

/**
 * Records a completion.
 *
 * `date` and `entryId` are both optional and mean progressively more specific things: nothing at
 * all is "today, in the caller's time zone" (SQL decides which day that is, from users.time_zone);
 * a date is a different day; an entry id is one particular occurrence, which is what a calendar
 * sends when a day holds more than one.
 *
 * Idempotent: completing a day that is already completed returns that occurrence with
 * `created: false` and writes nothing. A double tap, or a request the client retried because it
 * never saw the response, cannot count as two completions.
 */
export async function completeOccurrence(
  client: SupabaseUserClient,
  goalId: string,
  options: { date?: string; entryId?: string } = {},
  timeoutMs?: number,
): Promise<CompletionResult> {
  const rows = await runWrite(
    (signal) =>
      client
        .rpc('complete_occurrence', {
          p_goal_id: goalId,
          p_on: options.date ?? null,
          p_entry_id: options.entryId ?? null,
        })
        .abortSignal(signal),
    CONTEXT,
    timeoutMs,
  );

  const row = requireRow(rows, 'entry');
  return { created: readBoolean(row, 'created'), row };
}

/**
 * Takes a completion back, exactly.
 *
 * Which of the two things that means is the row's own business: an occurrence the completion
 * created is deleted, and any other goes back to the status it held — 'planned' for a session
 * from a rule, 'skipped' for a day that had been skipped before somebody ticked it. Neither
 * outcome needs the client to tell us what the state used to be.
 */
export async function undoOccurrence(
  client: SupabaseUserClient,
  goalId: string,
  entryId: string,
  timeoutMs?: number,
): Promise<UndoResult> {
  const rows = await runWrite(
    (signal) =>
      client.rpc('undo_occurrence', { p_goal_id: goalId, p_entry_id: entryId }).abortSignal(signal),
    CONTEXT,
    timeoutMs,
  );

  const row = requireRow(rows, 'entry');
  return { action: readEnum(row, 'action', UNDO_ACTIONS), row };
}

/**
 * The goal, reduced to what a calendar entry needs to render.
 *
 * Taken from the tile the route already read rather than from a third query: the effective colour
 * only exists inside goal_dashboard, and re-deriving it here would be the second copy of a rule
 * that must not drift from the calendar's.
 */
export function toEntryGoal(goal: GoalSummary): CalendarEntryGoal {
  return { id: goal.id, title: goal.title, kind: goal.kind, color: goal.color, area: goal.area };
}

/**
 * Removes one occurrence: "I am not running this Thursday."
 *
 * An RPC, not a DELETE through PostgREST, for the reason every other RPC here exists: it is a
 * decision and then a write, and the decision is the whole feature. A plain DELETE would take the
 * row out and the rule would put it straight back the next time it was edited — re-expansion
 * resumes from a boundary, and a day with no row has nothing to conflict with. So SQL cancels the
 * occurrence in place instead, which is simultaneously the record of the deletion and the thing
 * that occupies (recurrence_id, entry_date) so the generator's ON CONFLICT DO NOTHING finds it.
 * See supabase/migrations/20260924100000_delete_occurrence.sql; none of that reasoning is
 * repeated in TypeScript, and none of it can be got wrong here.
 *
 * Two refusals come back from it, both already in lib/write.ts's vocabulary: a 404 for an id that
 * is not there, is not the caller's, or has already been cancelled — one answer for all three,
 * which the client reads as "already gone" — and a 409 `entry_completed` for a day that is
 * completed, which has to be taken back through the completions route first.
 */
export async function deleteOccurrence(
  client: SupabaseUserClient,
  goalId: string,
  entryId: string,
  timeoutMs?: number,
): Promise<DeleteOccurrenceResult> {
  const rows = await runWrite(
    (signal) =>
      client
        .rpc('delete_occurrence', { p_goal_id: goalId, p_entry_id: entryId })
        .abortSignal(signal),
    DELETE_CONTEXT,
    timeoutMs,
  );

  const row = requireRow(rows, 'entry');
  return { action: readEnum(row, 'action', DELETE_ACTIONS), id: readString(row, 'id') };
}
