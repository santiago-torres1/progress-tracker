/*
 * Client for the read-only product API: /api/goals, /api/calendar, /api/areas.
 *
 * Two habits it keeps, both borrowed from lib/health.ts:
 *
 * 1. It never throws for an expected failure. A network error, a 503 and a body this build
 *    cannot read are all results, so the UI can say something calm instead of unmounting.
 *    The one exception is the caller's own abort, which is rethrown so React's cleanup wins.
 * 2. It validates before it hands anything on. `types/api.ts` is a hand-kept mirror of the
 *    backend's contract, so `as` would only be a promise that the two files still agree; the
 *    parsers below actually check. A response that does not match is `failed: 'malformed'`
 *    rather than a half-rendered canvas, because a silently dropped goal is a bug nobody sees.
 */

import type {
  AreasResponse,
  CalendarEntry,
  CalendarEntryGoal,
  CalendarResponse,
  EntryStatus,
  GoalArea,
  GoalKind,
  GoalProgress,
  GoalSize,
  GoalStatus,
  GoalSummary,
  GoalsResponse,
  HabitPeriod,
  HabitState,
  LifeArea,
  MeasuredState,
  ProgressBasis,
  ScheduledState,
  UnavailableReason,
} from '../types/api';
import { apiUrl } from './health';

// --- Result -----------------------------------------------------------------------------------

/** Why a request did not produce a body this app could use. Distinct from the API's own 503. */
export type ApiFailureReason = 'network' | 'timeout' | 'http' | 'malformed';

/**
 * What a read produced.
 *
 * The three non-ok branches are kept apart because they deserve different words on screen:
 * `unavailable` is the API saying so in the documented shape (and `missing_env` means "this
 * demo has no data source configured", not "something broke"), `rejected` is a 400 — this
 * client asked for something impossible — and `failed` never got a usable answer at all.
 */
export type ApiResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'unavailable'; reason: UnavailableReason; missing: readonly string[] }
  | { kind: 'rejected'; error: string; message: string | null }
  | { kind: 'failed'; reason: ApiFailureReason; status: number | null };

/** Every branch except the happy one, for code that has already ruled out success. */
export type ApiFailure = Exclude<ApiResult<never>, { kind: 'ok' }>;

export interface ApiRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 8000;

// --- Primitive guards -------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `Array.isArray` on an `unknown` widens to `any[]`; this keeps the items honest. */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** NaN and Infinity are not numbers the UI can draw a glass with. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Membership in a string union, via a table the compiler checks for completeness: adding a
 * member to one of these unions breaks the corresponding table rather than slipping through.
 */
function isMember<T extends string>(table: Readonly<Record<T, true>>, value: unknown): value is T {
  return typeof value === 'string' && Object.hasOwn(table, value);
}

const GOAL_KINDS: Readonly<Record<GoalKind, true>> = {
  scheduled: true,
  measured: true,
  habit: true,
};

const GOAL_STATUSES: Readonly<Record<GoalStatus, true>> = {
  active: true,
  paused: true,
  completed: true,
  archived: true,
};

const GOAL_SIZES: Readonly<Record<GoalSize, true>> = { small: true, medium: true, large: true };

const HABIT_PERIODS: Readonly<Record<HabitPeriod, true>> = { day: true, week: true, month: true };

const ENTRY_STATUSES: Readonly<Record<EntryStatus, true>> = {
  planned: true,
  completed: true,
  skipped: true,
  cancelled: true,
};

const PROGRESS_BASES: Readonly<Record<ProgressBasis, true>> = {
  measured_value: true,
  period_completion: true,
  session_target: true,
  session_adherence: true,
  none: true,
};

const UNAVAILABLE_REASONS: Readonly<Record<UnavailableReason, true>> = {
  missing_env: true,
  invalid_config: true,
  timeout: true,
  upstream_error: true,
};

function parseArray<T>(value: unknown, parseItem: (item: unknown) => T | null): T[] | null {
  if (!isUnknownArray(value)) return null;

  const parsed: T[] = [];
  for (const item of value) {
    const one = parseItem(item);
    if (one === null) return null;
    parsed.push(one);
  }
  return parsed;
}

function parseStringArray(value: unknown): string[] {
  if (!isUnknownArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

// --- Contract parsers -------------------------------------------------------------------------

function parseGoalArea(value: unknown): GoalArea | null {
  if (!isRecord(value)) return null;

  const { id, slug, name, icon } = value;
  if (typeof id !== 'string' || typeof slug !== 'string' || typeof name !== 'string') return null;
  if (!isNullableString(icon)) return null;

  return { id, slug, name, icon };
}

function parseLifeArea(value: unknown): LifeArea | null {
  const area = parseGoalArea(value);
  if (area === null || !isRecord(value)) return null;

  const { color, sortOrder, isSystem } = value;
  if (typeof color !== 'string' || !isFiniteNumber(sortOrder)) return null;
  if (typeof isSystem !== 'boolean') return null;

  return { ...area, color, sortOrder, isSystem };
}

/** `fraction: null` is "there is no denominator yet", never zero, and travels through untouched. */
function parseProgress(value: unknown): GoalProgress | null {
  if (!isRecord(value)) return null;

  const { basis, fraction } = value;
  if (!isMember(PROGRESS_BASES, basis)) return null;
  if (fraction !== null && !isFiniteNumber(fraction)) return null;

  return { basis, fraction };
}

function parseHabitState(value: unknown): HabitState | null {
  if (!isRecord(value)) return null;

  const { period, periodStart, periodEnd, minimumFraction, minimumMet } = value;
  const { completedCount, targetCount, minimumCount } = value;
  if (!isMember(HABIT_PERIODS, period)) return null;
  if (typeof periodStart !== 'string' || typeof periodEnd !== 'string') return null;
  if (!isFiniteNumber(completedCount) || !isFiniteNumber(targetCount)) return null;
  if (!isFiniteNumber(minimumCount) || !isFiniteNumber(minimumFraction)) return null;
  if (typeof minimumMet !== 'boolean') return null;

  return {
    period,
    periodStart,
    periodEnd,
    completedCount,
    targetCount,
    minimumCount,
    minimumFraction,
    minimumMet,
  };
}

function parseMeasuredState(value: unknown): MeasuredState | null {
  if (!isRecord(value)) return null;

  const { unit, startValue, targetValue, currentValue } = value;
  const { lastMeasuredOn, previousValue, previousMeasuredOn } = value;
  if (!isNullableString(unit)) return null;
  if (!isFiniteNumber(startValue) || !isFiniteNumber(targetValue)) return null;
  if (!isFiniteNumber(currentValue)) return null;
  if (!isNullableString(lastMeasuredOn) || !isNullableString(previousMeasuredOn)) return null;
  if (previousValue !== null && !isFiniteNumber(previousValue)) return null;

  return {
    unit,
    startValue,
    targetValue,
    currentValue,
    lastMeasuredOn,
    previousValue,
    previousMeasuredOn,
  };
}

function parseScheduledState(value: unknown): ScheduledState | null {
  if (!isRecord(value)) return null;

  const { targetSessions, plannedCount, completedCount, dueCount } = value;
  if (targetSessions !== null && !isFiniteNumber(targetSessions)) return null;
  if (!isFiniteNumber(plannedCount) || !isFiniteNumber(completedCount)) return null;
  if (!isFiniteNumber(dueCount)) return null;

  return { targetSessions, plannedCount, completedCount, dueCount };
}

function parseGoal(value: unknown): GoalSummary | null {
  if (!isRecord(value)) return null;

  const { id, title, description, status, size, sortOrder, color, kind } = value;
  const { startDate, targetDate, lastProgressOn, createdAt, updatedAt } = value;
  if (typeof id !== 'string' || typeof title !== 'string') return null;
  if (!isNullableString(description)) return null;
  if (!isMember(GOAL_STATUSES, status) || !isMember(GOAL_SIZES, size)) return null;
  if (!isMember(GOAL_KINDS, kind) || !isFiniteNumber(sortOrder)) return null;
  if (typeof color !== 'string') return null;
  if (!isNullableString(startDate) || !isNullableString(targetDate)) return null;
  if (!isNullableString(lastProgressOn)) return null;
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') return null;

  // A goal with no area is ordinary (the tile says "No area"); an unreadable one is not.
  let area: GoalArea | null = null;
  if (value.area !== null) {
    area = parseGoalArea(value.area);
    if (area === null) return null;
  }

  const progress = parseProgress(value.progress);
  if (progress === null) return null;

  const base = {
    id,
    title,
    description,
    status,
    size,
    sortOrder,
    area,
    color,
    startDate,
    targetDate,
    progress,
    lastProgressOn,
    createdAt,
    updatedAt,
  };

  switch (kind) {
    case 'habit': {
      const habit = parseHabitState(value.habit);
      return habit === null ? null : { ...base, kind, habit };
    }
    case 'measured': {
      const measured = parseMeasuredState(value.measured);
      return measured === null ? null : { ...base, kind, measured };
    }
    case 'scheduled': {
      const scheduled = parseScheduledState(value.scheduled);
      return scheduled === null ? null : { ...base, kind, scheduled };
    }
  }
}

function parseEntryGoal(value: unknown): CalendarEntryGoal | null {
  if (!isRecord(value)) return null;

  const { id, title, kind, color } = value;
  if (typeof id !== 'string' || typeof title !== 'string') return null;
  if (!isMember(GOAL_KINDS, kind) || typeof color !== 'string') return null;

  let area: GoalArea | null = null;
  if (value.area !== null) {
    area = parseGoalArea(value.area);
    if (area === null) return null;
  }

  return { id, title, kind, color, area };
}

function parseEntry(value: unknown): CalendarEntry | null {
  if (!isRecord(value)) return null;

  const { id, date, timeZone, title, notes, status } = value;
  const { completedAt, recurrenceId, timing, startAt, endAt } = value;
  if (typeof id !== 'string' || typeof date !== 'string' || typeof timeZone !== 'string') {
    return null;
  }
  if (!isNullableString(title) || !isNullableString(notes)) return null;
  if (!isMember(ENTRY_STATUSES, status)) return null;
  if (!isNullableString(completedAt) || !isNullableString(recurrenceId)) return null;

  let goal: CalendarEntryGoal | null = null;
  if (value.goal !== null) {
    goal = parseEntryGoal(value.goal);
    if (goal === null) return null;
  }

  const base = { id, date, timeZone, title, notes, status, completedAt, recurrenceId, goal };

  // The same check that picks the branch is the check that types it.
  if (timing === 'timed') {
    if (typeof startAt !== 'string' || typeof endAt !== 'string') return null;
    return { ...base, timing, startAt, endAt };
  }
  if (timing === 'untimed') {
    if (startAt !== null || endAt !== null) return null;
    return { ...base, timing, startAt, endAt };
  }
  return null;
}

function parseGoalsResponse(body: unknown): GoalsResponse | null {
  if (!isRecord(body)) return null;

  const goals = parseArray(body.goals, parseGoal);
  return goals === null ? null : { goals };
}

function parseCalendarResponse(body: unknown): CalendarResponse | null {
  if (!isRecord(body)) return null;

  const { from, to } = body;
  if (typeof from !== 'string' || typeof to !== 'string') return null;

  const entries = parseArray(body.entries, parseEntry);
  return entries === null ? null : { from, to, entries };
}

function parseAreasResponse(body: unknown): AreasResponse | null {
  if (!isRecord(body)) return null;

  const areas = parseArray(body.areas, parseLifeArea);
  return areas === null ? null : { areas };
}

interface ParsedError {
  error: string;
  message: string | null;
  reason: UnavailableReason | null;
  missing: readonly string[];
}

function parseApiError(body: unknown): ParsedError | null {
  if (!isRecord(body)) return null;

  const { error, message, reason, missing } = body;
  if (typeof error !== 'string') return null;

  return {
    error,
    message: typeof message === 'string' ? message : null,
    reason: isMember(UNAVAILABLE_REASONS, reason) ? reason : null,
    missing: parseStringArray(missing),
  };
}

// --- Requests ---------------------------------------------------------------------------------

function toFailure(status: number, body: unknown): ApiFailure {
  const parsed = parseApiError(body);

  if (status === 503 && parsed !== null) {
    // A 503 without a reason still means the read could not be served; say the general thing.
    return {
      kind: 'unavailable',
      reason: parsed.reason ?? 'upstream_error',
      missing: parsed.missing,
    };
  }
  if (status === 400 && parsed !== null) {
    return { kind: 'rejected', error: parsed.error, message: parsed.message };
  }
  return { kind: 'failed', reason: 'http', status };
}

async function requestJson<T>(
  path: string,
  parse: (body: unknown) => T | null,
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch }: ApiRequestOptions,
): Promise<ApiResult<T>> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetchImpl(apiUrl(path), {
      signal: combined,
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: 'failed', reason: timeout.aborted ? 'timeout' : 'network', status: null };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    // A non-JSON body (an HTML error page, an empty 503) is handled below as an unreadable one.
  }

  if (!response.ok) {
    return toFailure(response.status, body);
  }

  const data = parse(body);
  return data === null
    ? { kind: 'failed', reason: 'malformed', status: response.status }
    : { kind: 'ok', data };
}

/** GET /api/goals — every active goal, already in canvas order. */
export function fetchGoals(options: ApiRequestOptions = {}): Promise<ApiResult<GoalsResponse>> {
  return requestJson('/api/goals', parseGoalsResponse, options);
}

/**
 * GET /api/calendar — entries whose local day falls in an inclusive range.
 *
 * Both dates are `YYYY-MM-DD`. The backend rejects a reversed or over-long range with a 400,
 * which arrives here as `rejected`; the date helpers never build one.
 */
export function fetchCalendar(
  from: string,
  to: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<CalendarResponse>> {
  const query = new URLSearchParams({ from, to });
  return requestJson(`/api/calendar?${query.toString()}`, parseCalendarResponse, options);
}

/** GET /api/areas — the six life areas, in legend order. */
export function fetchAreas(options: ApiRequestOptions = {}): Promise<ApiResult<AreasResponse>> {
  return requestJson('/api/areas', parseAreasResponse, options);
}
