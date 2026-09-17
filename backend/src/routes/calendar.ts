import { Router } from 'express';

import { READ_CACHE_CONTROL, respondBadRequest, respondUnavailable } from './read-support.js';
import { fetchCalendarEntries } from '../lib/calendar-entries.js';
import { inclusiveDaySpan, parseIsoDate } from '../lib/dates.js';
import type { CalendarResponse } from '../types/api.js';

/**
 * Longest range a single request may ask for, in days, inclusive of both ends.
 *
 * A year and a day. It covers every view the UI could plausibly want (a month, a quarter, "this
 * year") plus one day of slack for an inclusive year, while stopping one unbounded request from
 * dragging the entire table through the Lambda. The demo's four recurrences materialise a few
 * hundred entries, so the practical cost of the limit today is zero; the point is that it is a
 * limit at all.
 */
export const MAX_CALENDAR_RANGE_DAYS = 366;

export interface CalendarRouterOptions {
  /** Upper bound on each Supabase round-trip. Overridable for tests. */
  readTimeoutMs?: number;
}

interface ValidRange {
  from: string;
  to: string;
}

interface RangeProblem {
  error: string;
  message: string;
}

/** Query parameters arrive as string | string[] | object; only a single string is a date. */
function singleParam(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Validates `from`/`to`. Every rejection names the parameter and says what was expected, because
 * the caller can fix those; nothing here reveals anything about the database.
 */
export function validateRange(query: Record<string, unknown>): ValidRange | RangeProblem {
  const from = singleParam(query.from);
  const to = singleParam(query.to);

  if (from === undefined || to === undefined) {
    const missing = [from === undefined ? 'from' : null, to === undefined ? 'to' : null]
      .filter((name): name is string => name !== null)
      .join(' and ');
    return {
      error: 'missing_parameter',
      message: `${missing} required, as a single YYYY-MM-DD date (e.g. ?from=2026-09-01&to=2026-09-30).`,
    };
  }

  const fromMs = parseIsoDate(from);
  const toMs = parseIsoDate(to);
  const invalid = [fromMs === undefined ? 'from' : null, toMs === undefined ? 'to' : null].filter(
    (name): name is string => name !== null,
  );
  if (fromMs === undefined || toMs === undefined) {
    return {
      error: 'invalid_date',
      message: `${invalid.join(' and ')} must be a real calendar date written as YYYY-MM-DD.`,
    };
  }

  if (fromMs > toMs) {
    return { error: 'invalid_range', message: 'from must be on or before to.' };
  }

  const days = inclusiveDaySpan(fromMs, toMs);
  if (days > MAX_CALENDAR_RANGE_DAYS) {
    return {
      error: 'range_too_long',
      message: `The range may span at most ${MAX_CALENDAR_RANGE_DAYS} days; this one spans ${days}.`,
    };
  }

  return { from, to };
}

/**
 * GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD — entries whose local day falls in the
 * inclusive range, each carrying enough of its goal to render without a second call.
 */
export function createCalendarRouter(options: CalendarRouterOptions = {}): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const range = validateRange(req.query);
    if ('error' in range) {
      respondBadRequest(res, range.error, range.message);
      return;
    }

    try {
      const entries = await fetchCalendarEntries(range.from, range.to, options.readTimeoutMs);
      const body: CalendarResponse = { from: range.from, to: range.to, entries };
      res.set('Cache-Control', READ_CACHE_CONTROL).json(body);
    } catch (error) {
      respondUnavailable(res, error, '[api/calendar]');
    }
  });

  return router;
}
