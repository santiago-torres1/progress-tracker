import { fetchGoalsByIds } from './goal-dashboard.js';
import { runQuery } from './read.js';
import {
  readDate,
  readEnum,
  readInstant,
  readOptionalInstant,
  readOptionalString,
  readString,
  type UnknownRow,
} from './row.js';
import type { SupabaseUserClient } from './supabase.js';
import { ENTRY_STATUSES } from '../types/database.js';
import type { CalendarEntry, CalendarEntryGoal } from '../types/api.js';

/*
 * Reads of public.calendar_entries for a date range.
 *
 * One timeline for every goal kind: a timed session, an untimed habit tick, and a plain
 * calendar item with no goal at all are all rows in this table.
 */

/**
 * `user_id` and `is_exception` are deliberately absent. `is_exception` is a write-side flag, and
 * `user_id` is neither selected nor filtered on: the calendar_entries_select policy scopes the
 * table to the caller, and a second filter here would only mask a policy regression.
 */
export const CALENDAR_ENTRY_COLUMNS = [
  'id',
  'goal_id',
  'recurrence_id',
  'title',
  'notes',
  'entry_date',
  'start_at',
  'end_at',
  'time_zone',
  'status',
  'completed_at',
].join(',');

/**
 * One calendar occurrence.
 *
 * Two bits of shaping, both of which are schema semantics rather than product rules:
 *
 * - `timing` makes the calendar_entries_timing_paired CHECK visible in the type. The column
 *   pair is read once and both fields are set together, so `timed` always carries two instants.
 * - `title` resolves the documented "NULL means show the goal's title" fallback here, once,
 *   instead of in every component that renders an entry.
 */
export function toCalendarEntry(
  row: UnknownRow,
  goalsById: Map<string, CalendarEntryGoal>,
): CalendarEntry {
  const goalId = readOptionalString(row, 'goal_id');
  const goal = goalId === null ? null : (goalsById.get(goalId) ?? null);

  const base = {
    id: readString(row, 'id'),
    date: readDate(row, 'entry_date'),
    timeZone: readString(row, 'time_zone'),
    title: readOptionalString(row, 'title') ?? goal?.title ?? null,
    notes: readOptionalString(row, 'notes'),
    status: readEnum(row, 'status', ENTRY_STATUSES),
    completedAt: readOptionalInstant(row, 'completed_at'),
    recurrenceId: readOptionalString(row, 'recurrence_id'),
    goal,
  };

  return readOptionalInstant(row, 'start_at') === null
    ? { ...base, timing: 'untimed', startAt: null, endAt: null }
    : {
        ...base,
        timing: 'timed',
        startAt: readInstant(row, 'start_at'),
        endAt: readInstant(row, 'end_at'),
      };
}

/**
 * Every entry whose local day falls in [from, to], with enough of each goal to render it.
 *
 * `entry_date, start_at nulls first` is the schema's documented calendar ordering, and it reads
 * the way a day reads: the all-day items first, then the timed ones in clock order. The range
 * is a single index scan on calendar_entries_user_date_idx.
 *
 * Two round-trips, in sequence: the goal lookup needs the ids the first query returns. It is
 * skipped entirely when the range contains no goal-linked entries.
 */
export async function fetchCalendarEntries(
  client: SupabaseUserClient,
  from: string,
  to: string,
  timeoutMs?: number,
): Promise<CalendarEntry[]> {
  const rows = await runQuery(
    (signal) =>
      client
        .from('calendar_entries')
        .select(CALENDAR_ENTRY_COLUMNS)
        .gte('entry_date', from)
        .lte('entry_date', to)
        .order('entry_date', { ascending: true })
        .order('start_at', { ascending: true, nullsFirst: true })
        .abortSignal(signal),
    '[api/calendar]',
    timeoutMs,
  );

  const goalIds = [
    ...new Set(
      rows
        .map((row) => readOptionalString(row, 'goal_id'))
        .filter((goalId): goalId is string => goalId !== null),
    ),
  ];
  const goalsById = await fetchGoalsByIds(client, goalIds, timeoutMs);

  return rows.map((row) => toCalendarEntry(row, goalsById));
}
