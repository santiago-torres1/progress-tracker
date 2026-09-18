import { runQuery } from './read.js';
import {
  readBoolean,
  readDate,
  readEnum,
  readInstant,
  readInteger,
  readOptionalDate,
  readOptionalString,
  readString,
  type UnknownRow,
} from './row.js';
import type { SupabaseUserClient } from './supabase.js';
import { RECURRENCE_FREQS } from '../types/database.js';
import type { Recurrence } from '../types/api.js';

/*
 * Reads of public.recurrences — the repeat rules behind a goal's target days.
 *
 * WHY THIS ROUTE EXISTS. The rules were write-only until now: a client could add, replace and
 * delete one, but could only LEARN a rule's id from the response to its own POST, or by finding a
 * materialised occurrence that carried `recurrence_id`. The second is a guess — occurrences are
 * only materialised to a horizon and a client only holds the window it asked the calendar for —
 * so "replace this goal's rule" quietly turned into "add a second rule" whenever every occurrence
 * happened to sit outside that window. A rule is a resource; this is its collection GET.
 *
 * `user_id` is neither selected nor filtered on, exactly as in lib/goal-dashboard.ts: the
 * recurrences_select policy is `user_id = current_user_id()`, and repeating that filter here
 * would hide a broken policy from the isolation tests rather than defend against one. The goal
 * id is a filter on `goal_id` alone, which is why another session asking for the same id gets an
 * empty list rather than somebody else's rules.
 */

/**
 * `user_id` is deliberately absent, as everywhere else on the read path.
 *
 * Every other column is present, including `is_active` and `generated_through`: the editor
 * replaces a rule whole (PUT, never PATCH), so it needs every field it is about to send back,
 * and a paused rule has to be visible to be un-paused.
 */
export const RECURRENCE_COLUMNS = [
  'id',
  'goal_id',
  'freq',
  'interval_count',
  'byweekday',
  'start_date',
  'until_date',
  'start_time',
  'end_time',
  'time_zone',
  'generated_through',
  'is_active',
  'created_at',
  'updated_at',
].join(',');

/**
 * One rule.
 *
 * Shared with the write path (lib/recurrence-write.ts), which maps the row its RPCs return
 * through this same function: a rule read back must be byte-identical to the rule that was just
 * written, or the editor would have two shapes to handle for one thing.
 */
export function toRecurrence(row: UnknownRow): Recurrence {
  const days: unknown = row.byweekday;
  return {
    id: readString(row, 'id'),
    goalId: readString(row, 'goal_id'),
    freq: readEnum(row, 'freq', RECURRENCE_FREQS),
    interval: readInteger(row, 'interval_count'),
    byWeekday: Array.isArray(days) ? days.map((day, index) => readWeekday(day, index)) : null,
    startDate: readDate(row, 'start_date'),
    untilDate: readOptionalDate(row, 'until_date'),
    startTime: readOptionalString(row, 'start_time'),
    endTime: readOptionalString(row, 'end_time'),
    timeZone: readString(row, 'time_zone'),
    generatedThrough: readOptionalDate(row, 'generated_through'),
    isActive: readBoolean(row, 'is_active'),
    createdAt: readInstant(row, 'created_at'),
    updatedAt: readInstant(row, 'updated_at'),
  };
}

/** `byweekday` is a smallint[]; narrow each element rather than trusting the array's contents. */
function readWeekday(value: unknown, index: number): number {
  return readInteger({ [`byweekday[${index}]`]: value }, `byweekday[${index}]`);
}

/**
 * Every rule on one goal, paused ones included, oldest first.
 *
 * No 404 and no "does this goal exist" probe. A goal with no rules, a goal that was deleted and a
 * goal belonging to somebody else are all an empty list from here, which is the same answer the
 * database gives and one fewer round trip than asking. The write routes are where a bad goal id
 * earns a 404, because a write has to name the goal it is changing.
 *
 * Ordered by `start_date`, then `created_at`, then `id`: two rules on one goal is "Tuesday at
 * 19:00 and Tuesday at 21:00", the pair is small, and the order has to be total so a list that
 * has not changed does not shuffle between requests.
 */
export async function fetchRecurrences(
  client: SupabaseUserClient,
  goalId: string,
  timeoutMs?: number,
): Promise<Recurrence[]> {
  const rows = await runQuery(
    (signal) =>
      client
        .from('recurrences')
        .select(RECURRENCE_COLUMNS)
        .eq('goal_id', goalId)
        .order('start_date', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .abortSignal(signal),
    '[api/goals/recurrences]',
    timeoutMs,
  );

  return rows.map(toRecurrence);
}
