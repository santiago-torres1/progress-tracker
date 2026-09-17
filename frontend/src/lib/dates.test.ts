import { describe, expect, it } from 'vitest';
import { formatCalendarDate } from '../components/format';
import {
  addDays,
  addMonths,
  endOfWeek,
  isSameMonth,
  monthGridDates,
  nowLabelFor,
  parseIsoDate,
  periodLabel,
  rangeForView,
  shiftAnchor,
  startOfWeek,
  toIsoDate,
  weekDates,
  weekdayLabels,
} from './dates';

/** Local midnight, written the way a person would say the date. */
function local(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

describe('toIsoDate / parseIsoDate', () => {
  it('round-trips a local date without slipping a day', () => {
    // toISOString() on this date is the day before in any zone west of UTC.
    expect(toIsoDate(new Date(2026, 8, 17, 0, 30))).toBe('2026-09-17');
    expect(toIsoDate(parseIsoDate('2026-09-17') ?? new Date(0))).toBe('2026-09-17');
  });

  it('rejects a date that does not exist', () => {
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('17/09/2026')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
  });

  it('accepts the leap day in a leap year only', () => {
    expect(parseIsoDate('2028-02-29')).not.toBeNull();
    expect(parseIsoDate('2026-02-29')).toBeNull();
  });
});

describe('week bounds (Monday start)', () => {
  it('leaves a Monday where it is', () => {
    expect(toIsoDate(startOfWeek(local(2026, 9, 14)))).toBe('2026-09-14');
  });

  it('pulls a Sunday back to the Monday six days earlier, not forward', () => {
    // The Sunday-start bug this catches would give 2026-09-20.
    expect(toIsoDate(startOfWeek(local(2026, 9, 20)))).toBe('2026-09-14');
    expect(toIsoDate(endOfWeek(local(2026, 9, 20)))).toBe('2026-09-20');
  });

  it('puts a midweek day in the week that contains it', () => {
    expect(toIsoDate(startOfWeek(local(2026, 9, 17)))).toBe('2026-09-14');
    expect(toIsoDate(endOfWeek(local(2026, 9, 17)))).toBe('2026-09-20');
  });

  it('crosses a month end', () => {
    expect(toIsoDate(startOfWeek(local(2026, 10, 1)))).toBe('2026-09-28');
    expect(toIsoDate(endOfWeek(local(2026, 8, 31)))).toBe('2026-09-06');
  });

  it('lists seven days in order', () => {
    expect(weekDates(local(2026, 9, 17))).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
  });
});

describe('addDays / addMonths', () => {
  it('keeps local midnight across a day step', () => {
    const next = addDays(local(2026, 3, 29), 1);
    expect(next.getHours()).toBe(0);
    expect(toIsoDate(next)).toBe('2026-03-30');
  });

  it('clamps a month step to the last day that exists', () => {
    expect(toIsoDate(addMonths(local(2026, 1, 31), 1))).toBe('2026-02-28');
    expect(toIsoDate(addMonths(local(2028, 1, 31), 1))).toBe('2028-02-29');
    expect(toIsoDate(addMonths(local(2026, 3, 31), -1))).toBe('2026-02-28');
  });

  it('crosses a year end', () => {
    expect(toIsoDate(addMonths(local(2026, 12, 15), 1))).toBe('2027-01-15');
    expect(toIsoDate(addMonths(local(2026, 1, 15), -1))).toBe('2025-12-15');
  });
});

describe('rangeForView', () => {
  it('asks for one day in the day view', () => {
    expect(rangeForView('day', local(2026, 9, 17))).toEqual({
      from: '2026-09-17',
      to: '2026-09-17',
    });
  });

  it('asks for Monday to Sunday in the week view', () => {
    expect(rangeForView('week', local(2026, 9, 17))).toEqual({
      from: '2026-09-14',
      to: '2026-09-20',
    });
  });

  it('asks for the whole month grid, padding included, in the month view', () => {
    // September 2026 starts on a Tuesday and ends on a Wednesday: both edges are padded, and
    // the padded days have entries of their own to show.
    expect(rangeForView('month', local(2026, 9, 17))).toEqual({
      from: '2026-08-31',
      to: '2026-10-04',
    });
  });

  it('pads a month that starts on a Sunday by a whole week', () => {
    // February 2026 starts on a Sunday — the hard case for a Monday-start grid.
    expect(rangeForView('month', local(2026, 2, 10))).toEqual({
      from: '2026-01-26',
      to: '2026-03-01',
    });
  });
});

describe('monthGridDates', () => {
  it('returns whole weeks and marks the days either side as outside', () => {
    const grid = monthGridDates(local(2026, 2, 10));

    expect(grid).toHaveLength(35);
    expect(grid[0]).toEqual({ date: '2026-01-26', outside: true });
    expect(grid[6]).toEqual({ date: '2026-02-01', outside: false });
    expect(grid[34]).toEqual({ date: '2026-03-01', outside: true });
    expect(grid.filter((day) => day.outside)).toHaveLength(7);
    expect(grid.filter((day) => !day.outside)).toHaveLength(28);
  });

  it('needs no padding for a 28-day month that starts on a Monday', () => {
    const grid = monthGridDates(local(2021, 2, 15));

    expect(grid).toHaveLength(28);
    expect(grid.some((day) => day.outside)).toBe(false);
  });

  it('runs to six rows when a 31-day month starts on a Saturday', () => {
    // August 2026: Sat 1st, so the grid needs 42 cells.
    const grid = monthGridDates(local(2026, 8, 1));

    expect(grid).toHaveLength(42);
    expect(grid[0]?.date).toBe('2026-07-27');
    expect(grid[41]?.date).toBe('2026-09-06');
  });
});

describe('weekdayLabels', () => {
  it('starts on Monday', () => {
    const labels = weekdayLabels();
    expect(labels).toHaveLength(7);
    // 1 January 2024 was a Monday, 7 January a Sunday.
    expect(labels[0]).toBe(formatCalendarDate('2024-01-01', { weekday: 'short' }));
    expect(labels[6]).toBe(formatCalendarDate('2024-01-07', { weekday: 'short' }));
  });

  it('gives seven distinct labels, because CalendarMonth keys its headings by label', () => {
    expect(new Set(weekdayLabels()).size).toBe(7);
  });
});

describe('nowLabelFor', () => {
  it('zero-pads, so it compares with entry times as a string', () => {
    expect(nowLabelFor(new Date(2026, 8, 17, 9, 5), '2026-09-17')).toBe('09:05');
    expect(nowLabelFor(new Date(2026, 8, 17, 23, 59), '2026-09-17')).toBe('23:59');
  });

  it('is undefined on any day but today', () => {
    expect(nowLabelFor(new Date(2026, 8, 17, 9, 5), '2026-09-18')).toBeUndefined();
    expect(nowLabelFor(new Date(2026, 8, 17, 9, 5), '2026-09-16')).toBeUndefined();
  });
});

describe('shiftAnchor', () => {
  it('steps by the period on show', () => {
    expect(toIsoDate(shiftAnchor('day', local(2026, 9, 17), 1))).toBe('2026-09-18');
    expect(toIsoDate(shiftAnchor('week', local(2026, 9, 17), -1))).toBe('2026-09-10');
    expect(toIsoDate(shiftAnchor('month', local(2026, 9, 17), 1))).toBe('2026-10-17');
  });

  it('steps a month from a day the next month does not have', () => {
    expect(toIsoDate(shiftAnchor('month', local(2026, 3, 31), -1))).toBe('2026-02-28');
  });

  it('keeps the week anchored on the same weekday across a month end', () => {
    expect(toIsoDate(shiftAnchor('week', local(2026, 9, 28), 1))).toBe('2026-10-05');
  });
});

describe('isSameMonth', () => {
  it('compares the month and the year', () => {
    expect(isSameMonth(local(2026, 9, 1), local(2026, 9, 30))).toBe(true);
    expect(isSameMonth(local(2026, 9, 30), local(2026, 10, 1))).toBe(false);
    expect(isSameMonth(local(2025, 9, 17), local(2026, 9, 17))).toBe(false);
  });
});

describe('periodLabel', () => {
  it('names the period the controls are pointing at', () => {
    expect(periodLabel('month', local(2026, 9, 17))).toContain('2026');
    expect(periodLabel('day', local(2026, 9, 17))).toContain('2026');
    // A week label carries both ends of the span.
    expect(periodLabel('week', local(2026, 9, 17))).toContain('–');
  });
});
