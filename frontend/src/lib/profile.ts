/*
 * The facts the profile page states, and the two lists it offers.
 *
 * Nothing here derives a number: every count on that page arrives in `SessionProfile.stats`,
 * already computed in the account's own time zone. What this module does is turn an instant into
 * the day it was in THAT zone, name a zone and a week start in words, and say what a saved change
 * means. `daysSinceStart` is read, never subtracted: two instants subtracted in the browser land
 * on the wrong side of midnight for anybody whose zone is not the one their days are counted in.
 *
 * It says nothing that could be read as a grade. "40 days ago" is the age of an account, not a
 * streak, and there is no best, first, longest or personal anything in this file — by instruction:
 * trophies would gamify a thing whose whole point is that it does not.
 */

import { formatCalendarDate, plural } from '../components/format';
import { DEFAULT_WEEK_START } from './dates';
import type { UpdateSessionRequest } from '../types/api';

const DAY_FORMAT: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

/**
 * `14 August 2026` — the day an instant fell on, in the zone the account keeps its days in.
 *
 * Null when the instant cannot be read at all, so a caller can leave the row out rather than
 * print `Invalid Date`. An unknown IANA zone is not that case: `Intl` throws on one, and the
 * viewer's own zone is a better answer than no date.
 */
export function accountDate(instant: string, timeZone: string): string | null {
  const when = new Date(instant);
  if (Number.isNaN(when.getTime())) return null;

  try {
    return new Intl.DateTimeFormat(undefined, { ...DAY_FORMAT, timeZone }).format(when);
  } catch {
    return new Intl.DateTimeFormat(undefined, DAY_FORMAT).format(when);
  }
}

/**
 * "Member since 14 August 2026 — 40 days ago."
 *
 * `daysSinceStart` is whole days that have passed, so the first day reads "today" rather than
 * "0 days ago", which would be both wrong and oddly bleak.
 */
export function memberSinceLine(
  createdAt: string,
  timeZone: string,
  daysSinceStart: number,
): string {
  const date = accountDate(createdAt, timeZone);
  if (date === null) return 'Here since your first visit.';

  if (!Number.isFinite(daysSinceStart) || daysSinceStart <= 0) {
    return `Member since ${date} — that is today.`;
  }
  const days = Math.floor(daysSinceStart);
  return `Member since ${date} — ${days} ${plural(days, 'day', 'days')} ago.`;
}

/**
 * `Europe/Madrid — GMT+2`, the zone named the way a person can check it against their own clock.
 *
 * The offset is asked for in `en-US` on purpose: it is a technical token, and `undefined` would
 * translate it per locale so the same zone read differently on two machines. The zone name itself
 * is the IANA string, because that is what the profile actually holds.
 */
export function zoneLabel(timeZone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(at);
    const offset = parts.find((part) => part.type === 'timeZoneName')?.value;
    return offset === undefined ? timeZone : `${timeZone} — ${offset}`;
  } catch {
    // A zone this browser cannot resolve is still the zone the server holds; say it plainly.
    return timeZone;
  }
}

/**
 * `Intl.supportedValuesOf`, typed as the optional thing it really is.
 *
 * It is absent on older Safari and on any runtime built without the data, and a profile page that
 * threw there would cost somebody the whole page for the sake of a `<select>`.
 */
function supportedTimeZones(): readonly string[] {
  const intl: { supportedValuesOf?: (key: 'timeZone') => string[] } = Intl;
  try {
    return intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
}

/**
 * The zones to offer, sorted, with the two that must always be there.
 *
 * `current` is the zone the account is on and `browserZone` is the one this machine is in; both go
 * in whether or not the browser can list the rest, because a picker that cannot show you where you
 * already are is a picker that can only lose your setting. The backend validates the choice against
 * the database's own list, so a zone this browser knows and the server does not is a 400 and not a
 * wrong day.
 */
export function timeZoneChoices(current: string, browserZone: string): string[] {
  const choices = new Set<string>([...supportedTimeZones(), current, browserZone, 'UTC']);
  return [...choices].sort((a, b) => a.localeCompare(b));
}

export interface WeekStartChoice {
  /** ISO day, 1 = Monday … 7 = Sunday, exactly as `PATCH /api/session` takes it. */
  value: number;
  label: string;
}

/**
 * Monday to Sunday with the days' own names.
 *
 * The names come from a real week — 14 to 20 September 2026, whose Monday is the 14th — so they are
 * the viewer's own language rather than seven English strings in an array.
 */
const ISO_WEEK: readonly string[] = [
  '2026-09-14',
  '2026-09-15',
  '2026-09-16',
  '2026-09-17',
  '2026-09-18',
  '2026-09-19',
  '2026-09-20',
];

export function weekStartChoices(): WeekStartChoice[] {
  return ISO_WEEK.map((date, index) => ({
    value: index + 1,
    label: formatCalendarDate(date, { weekday: 'long' }),
  }));
}

/** The name of one ISO day. Anything the API could not mean falls back to the default week start. */
export function weekStartLabel(weekStartsOn: number): string {
  const choices = weekStartChoices();
  const named = choices.find((choice) => choice.value === weekStartsOn);
  const fallback = choices.find((choice) => choice.value === DEFAULT_WEEK_START);
  return named?.label ?? fallback?.label ?? 'Monday';
}

/**
 * What a saved change means, in one sentence.
 *
 * Both of these settings are load-bearing rather than cosmetic — they decide which day a tick
 * lands on and where a habit's week begins — so the confirmation says what changed about the app
 * rather than just "Saved".
 */
export function savedNote(patch: UpdateSessionRequest): string {
  if (patch.timeZone !== undefined) {
    return `Saved. Your days are counted in ${patch.timeZone} from now on.`;
  }
  if (patch.weekStartsOn !== undefined) {
    return `Saved. Your weeks start on ${weekStartLabel(patch.weekStartsOn)} from now on.`;
  }
  return 'Saved.';
}
