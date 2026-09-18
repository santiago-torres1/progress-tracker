/*
 * Calendar arithmetic, in the viewer's own time zone.
 *
 * The design components deliberately have no clock: they are handed `isToday`, `outside`,
 * `nowLabel` and a range of days, and draw exactly that. This module is where those come from.
 *
 * Everything works in local time and speaks `YYYY-MM-DD` at its edges, the same strings the API
 * uses for `entry.date`. Dates are built with the `Date(year, month, day)` constructor rather
 * than by adding milliseconds, so a day either side of a daylight-saving change is still one day.
 */

import { formatCalendarDate } from '../components/format';
import type { CalendarView } from '../components/CalendarViewSwitcher';

/**
 * The day a week starts on, in the API's own numbering: ISO, 1 = Monday ... 7 = Sunday.
 *
 * It comes from GET /api/session and is threaded through every helper below as an argument. It
 * used to be a hardcoded Monday, which was wrong for roughly half the world and silently put a
 * habit's week boundary in the wrong place; there is deliberately no module-level default left, so
 * a caller cannot forget to pass it.
 */
export type WeekStart = number;

/** Monday, for the one place with genuinely no profile to read: a test's default. */
export const DEFAULT_WEEK_START: WeekStart = 1;

/** ISO (1 = Monday ... 7 = Sunday) as `Date.getDay()` numbers it (0 = Sunday ... 6 = Saturday). */
function toDayIndex(weekStartsOn: WeekStart): number {
  const iso = Number.isFinite(weekStartsOn) ? Math.trunc(weekStartsOn) : DEFAULT_WEEK_START;
  const wrapped = (((iso - 1) % DAYS_IN_WEEK) + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  return (wrapped + 1) % DAYS_IN_WEEK;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const DAYS_IN_WEEK = 7;

/**
 * The calendar day an instant falls on, in a named IANA zone.
 *
 * THIS IS THE ONE THAT MATTERS. The backend resolves "complete today" against the profile's zone,
 * so a UI that works out today from the browser's zone will disagree with it for anyone whose two
 * zones differ — and will do so most visibly late in the evening, which is when people tick things
 * off. Every "today" on screen comes through here.
 *
 * `en-CA` renders `YYYY-MM-DD` natively, which is the same string the API speaks. An unknown zone
 * falls back to the browser's own rather than throwing: a wrong day is bad, a blank page is worse.
 */
export function isoDateIn(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return toIsoDate(date);
  }
}

/** A local calendar day as `YYYY-MM-DD`. Never `toISOString()`, which would shift the day. */
export function toIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * `YYYY-MM-DD` as local midnight, or null if it is not a real date.
 *
 * The round-trip is what rejects `2026-02-30`: the Date constructor rolls it into March rather
 * than complaining, so the only proof the input was real is that it formats back to itself.
 */
export function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) return null;

  const [, year, month, day] = match;
  if (year === undefined || month === undefined || day === undefined) return null;

  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return toIsoDate(parsed) === value ? parsed : null;
}

/** Local midnight on the same day. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Months, clamped: 31 January plus a month is 28 or 29 February, never 3 March. */
export function addMonths(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay));
}

export function startOfWeek(date: Date, weekStartsOn: WeekStart): Date {
  const start = startOfDay(date);
  const shift = (start.getDay() - toDayIndex(weekStartsOn) + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  return addDays(start, -shift);
}

export function endOfWeek(date: Date, weekStartsOn: WeekStart): Date {
  return addDays(startOfWeek(date, weekStartsOn), DAYS_IN_WEEK - 1);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Day 0 of the next month is the last day of this one. */
export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export interface DateRange {
  from: string;
  to: string;
}

/**
 * The inclusive range a view needs from `GET /api/calendar`.
 *
 * The month asks for its whole grid, not its own first-to-last: the cells either side of the
 * month are drawn, so their entries have to be fetched or they would look empty rather than
 * quiet. The widest this returns is 42 days, comfortably inside the API's 366-day limit.
 */
export function rangeForView(view: CalendarView, anchor: Date, weekStartsOn: WeekStart): DateRange {
  switch (view) {
    case 'day': {
      const iso = toIsoDate(anchor);
      return { from: iso, to: iso };
    }
    case 'week':
      return {
        from: toIsoDate(startOfWeek(anchor, weekStartsOn)),
        to: toIsoDate(endOfWeek(anchor, weekStartsOn)),
      };
    case 'month':
      return {
        from: toIsoDate(startOfWeek(startOfMonth(anchor), weekStartsOn)),
        to: toIsoDate(endOfWeek(endOfMonth(anchor), weekStartsOn)),
      };
  }
}

/** One step back or forward: a day, a week, or a month kept on the same day number. */
export function shiftAnchor(view: CalendarView, anchor: Date, direction: -1 | 1): Date {
  switch (view) {
    case 'day':
      return addDays(anchor, direction);
    case 'week':
      return addDays(anchor, direction * DAYS_IN_WEEK);
    case 'month':
      return addMonths(anchor, direction);
  }
}

/** The seven days of the anchor's week, in the order the week starts. */
export function weekDates(anchor: Date, weekStartsOn: WeekStart): string[] {
  const start = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: DAYS_IN_WEEK }, (_, index) => toIsoDate(addDays(start, index)));
}

export interface MonthGridDay {
  date: string;
  /** A day from the month either side, shown for shape only. */
  outside: boolean;
}

/** Whole weeks covering the anchor's month: 28, 35 or 42 cells, always starting on week start. */
export function monthGridDates(anchor: Date, weekStartsOn: WeekStart): MonthGridDay[] {
  const month = anchor.getMonth();
  const start = startOfWeek(startOfMonth(anchor), weekStartsOn);
  const end = endOfWeek(endOfMonth(anchor), weekStartsOn);

  const days: MonthGridDay[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    days.push({ date: toIsoDate(day), outside: day.getMonth() !== month });
  }
  return days;
}

/**
 * A Sunday in a known week. `startOfWeek` turns it into whichever day the week starts on, so the
 * column headings follow the profile's week start without a second place to keep in step.
 */
const REFERENCE_WEEK = new Date(2024, 0, 7);

/**
 * Seven column headings for the month grid.
 *
 * Short rather than narrow: CalendarMonth keys its heading cells by label, and narrow English
 * weekdays are "M T W T F S S" — two pairs of duplicate keys.
 */
export function weekdayLabels(weekStartsOn: WeekStart): string[] {
  const start = startOfWeek(REFERENCE_WEEK, weekStartsOn);
  return Array.from({ length: DAYS_IN_WEEK }, (_, index) =>
    formatCalendarDate(toIsoDate(addDays(start, index)), { weekday: 'short' }),
  );
}

/**
 * `15:42` for the now-line, but only on the day that is actually today.
 *
 * Zero-padded 24-hour, because CalendarDay slots it into the hour spine by comparing it as a
 * string against the entry times, which `formatTime` renders the same way.
 */
export function nowLabelFor(now: Date, dayIso: string): string | undefined {
  if (toIsoDate(now) !== dayIso) return undefined;

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

const LONG_DAY: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

/** What the period controls are pointing at: "Thursday 17 September 2026", a span, a month. */
export function periodLabel(view: CalendarView, anchor: Date, weekStartsOn: WeekStart): string {
  switch (view) {
    case 'day':
      return formatCalendarDate(toIsoDate(anchor), LONG_DAY);
    case 'week': {
      const from = formatCalendarDate(toIsoDate(startOfWeek(anchor, weekStartsOn)), {
        day: 'numeric',
        month: 'short',
      });
      const to = formatCalendarDate(toIsoDate(endOfWeek(anchor, weekStartsOn)), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      return `${from} – ${to}`;
    }
    case 'month':
      return formatCalendarDate(toIsoDate(anchor), { month: 'long', year: 'numeric' });
  }
}
