/**
 * Plain calendar dates, as `YYYY-MM-DD` strings.
 *
 * PostgreSQL `date` columns arrive from PostgREST already in this form and the API hands them
 * back unchanged: a weigh-in happens on a day, not at an instant, and turning it into a
 * timestamp would invent a time zone the caller then has to un-invent.
 */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Milliseconds since the epoch at midnight UTC on an ISO date, or undefined if the string is
 * not a real calendar date.
 *
 * The round-trip check is what rejects `2026-02-30` and `2026-13-01`: Date.UTC happily rolls
 * those over into March and January, so the only way to know the input was real is to format
 * the result back and compare.
 */
export function parseIsoDate(value: string): number | undefined {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) return undefined;

  const [, year, month, day] = match;
  if (year === undefined || month === undefined || day === undefined) return undefined;

  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (!Number.isFinite(timestamp)) return undefined;

  return new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : undefined;
}

/** True when `value` is a real calendar date written as `YYYY-MM-DD`. */
export function isIsoDate(value: string): boolean {
  return parseIsoDate(value) !== undefined;
}

/** Days from `from` to `to`, inclusive of both ends. Same day = 1. */
export function inclusiveDaySpan(from: number, to: number): number {
  return Math.round((to - from) / MILLISECONDS_PER_DAY) + 1;
}
