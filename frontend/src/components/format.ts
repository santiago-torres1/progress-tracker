/*
 * Presentation-only formatting for the goal and calendar components.
 *
 * Nothing here fetches, decides or derives product meaning: it turns numbers and the API's date
 * strings into the text the design asks for, and every function is total — an unparseable value
 * comes back as itself rather than as "Invalid Date".
 */

const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  // The design is 24-hour throughout, so hours stay comparable and the columns stay aligned.
  hourCycle: 'h23',
};

/** `Intl` throws on an unknown IANA zone; fall back to the viewer's own rather than blowing up. */
function timeFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(undefined, { ...TIME_OPTIONS, timeZone });
  } catch {
    return new Intl.DateTimeFormat(undefined, TIME_OPTIONS);
  }
}

/** `YYYY-MM-DD` as a local calendar date, so formatting it never slips a day across time zones. */
function parseCalendarDate(date: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) {
    return null;
  }

  const [, year, month, day] = match;
  if (year === undefined || month === undefined || day === undefined) {
    return null;
  }

  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** One instant as `09:30`, read in the zone the entry was authored in. */
export function formatTime(instant: string, timeZone: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    return instant;
  }
  return timeFormatter(timeZone).format(date);
}

/** A timed entry's span as `09:30–10:10`. */
export function formatTimeRange(start: string, end: string, timeZone: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return formatTime(start, timeZone);
  }

  const format = timeFormatter(timeZone);
  return `${format.format(startDate)}–${format.format(endDate)}`;
}

/** `YYYY-MM-DD` rendered however the caller asks: `16 September`, `Wednesday`, `16`. */
export function formatCalendarDate(date: string, options: Intl.DateTimeFormatOptions): string {
  const parsed = parseCalendarDate(date);
  if (parsed === null) {
    return date;
  }
  return new Intl.DateTimeFormat(undefined, options).format(parsed);
}

/** A measured value, kept to the two decimals a weight or a balance actually needs. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

/** A 0–1 fraction as `57%`. Never above 100, never below 0. */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) {
    return '—';
  }
  return `${Math.round(Math.min(Math.max(fraction, 0), 1) * 100)}%`;
}

/** A 0–1 fraction as the 0–100 level CSS fills a glass to, kept to one decimal. */
export function toLevel(fraction: number): number {
  if (!Number.isFinite(fraction)) {
    return 0;
  }
  return Math.round(Math.min(Math.max(fraction, 0), 1) * 1000) / 10;
}

/** `thing` / `things`, so a count never reads like a form field. */
export function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}
