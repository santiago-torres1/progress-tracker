import { describe, expect, it } from 'vitest';
import { ENTRIES, NOW, TODAY_ISO } from '../test/fixtures';
import type { CalendarEntry } from '../types/api';
import {
  displayForToday,
  entryDisplay,
  groupEntriesByDate,
  scheduledGoalIds,
  stillToCome,
} from './entries';

function entry(id: string): CalendarEntry {
  const found = ENTRIES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No fixture entry ${id}`);
  return found;
}

describe('entryDisplay', () => {
  it('tags a completed entry with no recurrence as logged, not planned', () => {
    // It counts exactly as much as a planned one; the tag is the only difference. The goal must
    // have target days in view for "not planned" to mean anything — entry-run-mon supplies them.
    const scheduled = scheduledGoalIds(ENTRIES);
    expect(entryDisplay(entry('entry-run-thu'), TODAY_ISO, scheduled)).toEqual({ unplanned: true });
  });

  it('says nothing about a completed one-off for a goal that has no target days', () => {
    // Without this, every completed one-off in the calendar reads "logged, not planned", which
    // is noise: a one-off that was planned as a one-off was not unplanned.
    const oneOff = entry('entry-run-thu');
    const goal = oneOff.goal;
    if (goal === null) throw new Error('fixture entry-run-thu should carry a goal');
    const scheduledElsewhere = scheduledGoalIds([]);
    expect(entryDisplay(oneOff, TODAY_ISO, scheduledElsewhere)).toBeUndefined();
    expect(scheduledGoalIds(ENTRIES).has(goal.id)).toBe(true);
  });

  it('leaves a completed entry that came from a repeat rule alone', () => {
    expect(entryDisplay(entry('entry-run-mon'), TODAY_ISO)).toBeUndefined();
  });

  it('fades a planned entry whose day has passed, and says nothing else about it', () => {
    expect(entryDisplay(entry('entry-spanish-tue'), TODAY_ISO)).toEqual({ tone: 'missed' });
  });

  it('never fades something planned for today, whatever the hour', () => {
    // 18:30 today, read at 09:30: the day is not over, and a day is the only unit used here.
    expect(entryDisplay(entry('entry-spanish-thu'), TODAY_ISO)).toBeUndefined();
    expect(entryDisplay(entry('entry-call-thu'), TODAY_ISO)).toBeUndefined();
  });

  it('never fades something still ahead', () => {
    expect(entryDisplay(entry('entry-run-fri'), TODAY_ISO)).toBeUndefined();
  });

  it('binds to a day for the calendar components', () => {
    const displayFor = displayForToday(TODAY_ISO, ENTRIES);
    expect(displayFor(entry('entry-spanish-tue'))).toEqual({ tone: 'missed' });
    expect(displayFor(entry('entry-run-fri'))).toBeUndefined();
  });
});

describe('groupEntriesByDate', () => {
  it('keeps the API order inside each day', () => {
    const byDate = groupEntriesByDate(ENTRIES);

    // The API puts the untimed ones first, then the timed ones in clock order.
    expect(byDate.get(TODAY_ISO)?.map((item) => item.id)).toEqual([
      'entry-call-thu',
      'entry-run-thu',
      'entry-standup-thu',
      'entry-spanish-thu',
    ]);
    expect(byDate.get('2026-09-19')).toBeUndefined();
  });
});

describe('stillToCome', () => {
  const today = ENTRIES.filter((item) => item.date === TODAY_ISO);

  it('lists what is still planned for today', () => {
    expect(stillToCome(today, TODAY_ISO, NOW).map((item) => item.id)).toEqual([
      'entry-call-thu',
      'entry-spanish-thu',
    ]);
  });

  it('leaves what is already done out of it', () => {
    const ids = stillToCome(today, TODAY_ISO, NOW).map((item) => item.id);
    expect(ids).not.toContain('entry-run-thu');
  });

  it('drops something whose hour has gone, without calling it missed', () => {
    const ids = stillToCome(today, TODAY_ISO, NOW).map((item) => item.id);

    // 09:00–09:15, read at 09:30: no longer "still to come"…
    expect(ids).not.toContain('entry-standup-thu');
    // …and still not a failure, because the day it is on is today.
    expect(entryDisplay(entry('entry-standup-thu'), TODAY_ISO)).toBeUndefined();
  });

  it('keeps a timed entry until its end has passed', () => {
    const during = new Date(2026, 8, 17, 19, 0);
    const after = new Date(2026, 8, 17, 20, 0);

    expect(stillToCome(today, TODAY_ISO, during).map((item) => item.id)).toContain(
      'entry-spanish-thu',
    );
    expect(stillToCome(today, TODAY_ISO, after).map((item) => item.id)).not.toContain(
      'entry-spanish-thu',
    );
  });

  it('keeps an untimed entry all day, because anytime is true until the day is over', () => {
    const lateTonight = new Date(2026, 8, 17, 23, 30);
    expect(stillToCome(today, TODAY_ISO, lateTonight).map((item) => item.id)).toEqual([
      'entry-call-thu',
    ]);
  });

  it('ignores other days entirely', () => {
    expect(stillToCome(ENTRIES, TODAY_ISO, NOW).every((item) => item.date === TODAY_ISO)).toBe(
      true,
    );
  });
});
