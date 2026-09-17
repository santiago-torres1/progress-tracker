/*
 * The two judgements about a calendar entry that no entry carries, plus the grouping the views
 * need. Both judgements need something the API cannot know: today's date, and how the entry came
 * to exist.
 *
 * Neither is a failure state. "Planned, didn't happen" is faded and dashed and says nothing more;
 * "logged, not planned" is a quiet tag on something that still counts, exactly as much as if it
 * had been planned.
 */

import type { EntryDisplay } from '../components/EntryBar';
import type { CalendarEntry } from '../types/api';

/**
 * How one bar should read, given today.
 *
 * - Completed with no recurrence behind it, for a goal that *does* have scheduled days in view:
 *   logged, not planned. It counts. A goal with no schedule at all has no "not planned" to be
 *   the opposite of, so a completed one-off there is simply done.
 * - Still planned on a day that has passed: it did not happen, and that is all that is said.
 *   The test is the whole day, not the clock — an entry at 18:00 today has not been missed at
 *   nine in the morning, and today never reads as missed at all.
 */
export function entryDisplay(
  entry: CalendarEntry,
  todayIso: string,
  scheduledGoalIds: ReadonlySet<string> = new Set(),
): EntryDisplay | undefined {
  if (entry.status === 'completed' && entry.recurrenceId === null) {
    // Only meaningful when this goal has target days somewhere in view. Without that, every
    // completed one-off would be labelled "logged, not planned", which is just noise.
    const goalId = entry.goal?.id;
    return goalId !== undefined && scheduledGoalIds.has(goalId) ? { unplanned: true } : undefined;
  }
  if (entry.status === 'planned' && entry.date < todayIso) {
    return { tone: 'missed' };
  }
  return undefined;
}

/**
 * Goals that have at least one recurrence-backed entry in the given set — i.e. goals with
 * target days. Derived from what is in view because the API exposes no "has a schedule" flag;
 * a field on the goal would be the better answer if this ever needs to be exact.
 */
export function scheduledGoalIds(entries: readonly CalendarEntry[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.recurrenceId !== null && entry.goal !== null) {
      ids.add(entry.goal.id);
    }
  }
  return ids;
}

/** `displayFor`, bound to a day and to what is in view, for the calendar components. */
export function displayForToday(
  todayIso: string,
  entries: readonly CalendarEntry[] = [],
): (entry: CalendarEntry) => EntryDisplay | undefined {
  const scheduled = scheduledGoalIds(entries);
  return (entry) => entryDisplay(entry, todayIso, scheduled);
}

/**
 * Entries by local day.
 *
 * The API returns a range already ordered by day, then by start time with the untimed ones
 * first, and this keeps that order inside each day — it is the order the views want to read.
 */
export function groupEntriesByDate(
  entries: readonly CalendarEntry[],
): ReadonlyMap<string, CalendarEntry[]> {
  const byDate = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const day = byDate.get(entry.date);
    if (day === undefined) {
      byDate.set(entry.date, [entry]);
    } else {
      day.push(entry);
    }
  }
  return byDate;
}

/**
 * What is left of today, for the strip under the canvas.
 *
 * Only things still planned: what is done is already in the glasses, and what was skipped is
 * nobody's business by the afternoon. A timed entry stays until its end has passed, so something
 * happening right now still reads as being in front of you; an untimed one stays all day,
 * because "anytime" is true until the day is over.
 */
export function stillToCome(
  entries: readonly CalendarEntry[],
  todayIso: string,
  now: Date,
): CalendarEntry[] {
  return entries.filter((entry) => {
    if (entry.date !== todayIso || entry.status !== 'planned') return false;
    if (entry.timing === 'untimed') return true;

    const end = new Date(entry.endAt);
    return Number.isNaN(end.getTime()) || end.getTime() >= now.getTime();
  });
}
