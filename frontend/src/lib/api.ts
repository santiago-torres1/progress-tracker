/*
 * Client for the product API: the dashboard reads, and every write behind them.
 *
 * EVERY /api CALL CARRIES A BEARER TOKEN. The backend serves each request as the caller's own
 * Supabase user so row-level security does the isolating, and answers 401 without one. The token
 * arrives here as `accessToken` on the options — it is never read from a module-level global,
 * because a request that quietly picks up "whoever signed in last" is exactly the bug RLS is meant
 * to make impossible to write.
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
  AuthReason,
  CalendarEntry,
  CalendarEntryGoal,
  CalendarResponse,
  CompleteOccurrenceRequest,
  CompletionResponse,
  ConflictReason,
  CreateGoalRequest,
  DeleteMeasurementResponse,
  DeleteRecurrenceResponse,
  EntryStatus,
  GoalArea,
  GoalKind,
  GoalLayoutTile,
  GoalProgress,
  GoalResponse,
  GoalSize,
  GoalStatus,
  GoalSummary,
  GoalTemplate,
  GoalTemplateGroup,
  GoalTemplatesResponse,
  GoalsResponse,
  HabitPeriod,
  HabitState,
  LayoutResponse,
  LifeArea,
  LogMeasurementRequest,
  Measurement,
  MeasurementResponse,
  MeasuredState,
  NotFoundReason,
  OccurrenceChange,
  ProgressBasis,
  Recurrence,
  RecurrenceFreq,
  RecurrenceInput,
  RecurrenceResponse,
  RecurrencesResponse,
  ScheduledState,
  SessionProfile,
  SessionResponse,
  SessionStats,
  UnavailableReason,
  UndoCompletionResponse,
  UpdateGoalRequest,
  UpdateLayoutRequest,
  UpdateMeasurementRequest,
  UpdateSessionRequest,
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
  | { kind: 'unauthenticated'; reason: AuthReason | null }
  | { kind: 'unavailable'; reason: UnavailableReason; missing: readonly string[] }
  | { kind: 'rejected'; error: string; message: string | null; field: string | null }
  | { kind: 'missing'; reason: NotFoundReason | null }
  | { kind: 'conflict'; error: string; reason: ConflictReason | null; limit: string | null }
  | { kind: 'throttled'; retryAfterSeconds: number | null }
  | { kind: 'failed'; reason: ApiFailureReason; status: number | null };

/** Every branch except the happy one, for code that has already ruled out success. */
export type ApiFailure = Exclude<ApiResult<never>, { kind: 'ok' }>;

export interface ApiRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /**
   * The caller's Supabase access token. Absent only in tests and in the one code path that has
   * not signed in yet; the API answers 401, which arrives back as `unauthenticated`.
   */
  accessToken?: string;
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

const AUTH_REASONS: Readonly<Record<AuthReason, true>> = {
  missing_token: true,
  malformed_token: true,
  invalid_token: true,
  no_profile: true,
};

const NOT_FOUND_REASONS: Readonly<Record<NotFoundReason, true>> = {
  goal: true,
  entry: true,
  recurrence: true,
  measurement: true,
};

const CONFLICT_REASONS: Readonly<Record<ConflictReason, true>> = {
  wrong_goal_kind: true,
  duplicate: true,
};

const RECURRENCE_FREQS: Readonly<Record<RecurrenceFreq, true>> = {
  daily: true,
  weekly: true,
  monthly: true,
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

function parseGoalResponse(body: unknown): GoalResponse | null {
  if (!isRecord(body)) return null;

  const goal = parseGoal(body.goal);
  return goal === null ? null : { goal };
}

/**
 * The profile page's counts.
 *
 * All five are required. A missing one is a contract mismatch, not "assume zero": zero is a real
 * answer here — a visitor who has made nothing yet gets a row of them — so coercing an absent
 * field into one would render a brand-new-looking account to somebody with a full board.
 */
function parseSessionStats(value: unknown): SessionStats | null {
  if (!isRecord(value)) return null;

  const { goalsOnBoard, glassesFilled, daysSinceStart } = value;
  const { completionsRecorded, measurementsRecorded } = value;
  if (!isFiniteNumber(goalsOnBoard) || !isFiniteNumber(glassesFilled)) return null;
  if (!isFiniteNumber(completionsRecorded) || !isFiniteNumber(measurementsRecorded)) return null;
  if (!isFiniteNumber(daysSinceStart)) return null;

  return {
    goalsOnBoard,
    glassesFilled,
    completionsRecorded,
    measurementsRecorded,
    daysSinceStart,
  };
}

function parseSessionProfile(value: unknown): SessionProfile | null {
  if (!isRecord(value)) return null;

  const { timeZone, weekStartsOn, isAnonymous, expiresAt, createdAt } = value;
  if (typeof timeZone !== 'string' || !isFiniteNumber(weekStartsOn)) return null;
  if (typeof isAnonymous !== 'boolean' || !isNullableString(expiresAt)) return null;
  if (typeof createdAt !== 'string') return null;

  const stats = parseSessionStats(value.stats);
  if (stats === null) return null;

  return { timeZone, weekStartsOn, isAnonymous, expiresAt, createdAt, stats };
}

function parseSessionResponse(body: unknown): SessionResponse | null {
  if (!isRecord(body)) return null;

  const session = parseSessionProfile(body.session);
  return session === null ? null : { session };
}

function parseTemplate(value: unknown): GoalTemplate | null {
  if (!isRecord(value)) return null;

  const { id, slug, title, areaId, sortOrder, kind, repeat } = value;
  if (typeof id !== 'string' || typeof slug !== 'string' || typeof title !== 'string') return null;
  if (typeof areaId !== 'string' || !isFiniteNumber(sortOrder)) return null;
  if (!isMember(GOAL_KINDS, kind)) return null;

  let cadence: { freq: RecurrenceFreq; interval: number } | null = null;
  if (repeat !== null) {
    if (!isRecord(repeat) || !isMember(RECURRENCE_FREQS, repeat.freq)) return null;
    if (!isFiniteNumber(repeat.interval)) return null;
    cadence = { freq: repeat.freq, interval: repeat.interval };
  }

  const base = { id, slug, title, areaId, sortOrder, repeat: cadence };

  switch (kind) {
    case 'habit': {
      const block = value.habit;
      if (!isRecord(block) || !isMember(HABIT_PERIODS, block.period)) return null;
      if (!isFiniteNumber(block.targetCount) || !isFiniteNumber(block.minimumCount)) return null;
      const { targetCount, minimumCount, period } = block;
      return { ...base, kind, habit: { targetCount, minimumCount, period } };
    }
    case 'measured': {
      const block = value.measured;
      if (!isRecord(block) || !isNullableString(block.unit)) return null;
      const { unit, startValue, targetValue } = block;
      if (startValue !== null && !isFiniteNumber(startValue)) return null;
      if (targetValue !== null && !isFiniteNumber(targetValue)) return null;
      return { ...base, kind, measured: { unit, startValue, targetValue } };
    }
    case 'scheduled': {
      const block = value.scheduled;
      if (!isRecord(block)) return null;
      const { targetSessions } = block;
      if (targetSessions !== null && !isFiniteNumber(targetSessions)) return null;
      return { ...base, kind, scheduled: { targetSessions } };
    }
  }
}

function parseTemplateGroup(value: unknown): GoalTemplateGroup | null {
  if (!isRecord(value)) return null;

  const area = parseLifeArea(value.area);
  if (area === null) return null;

  const templates = parseArray(value.templates, parseTemplate);
  return templates === null ? null : { area, templates };
}

function parseTemplatesResponse(body: unknown): GoalTemplatesResponse | null {
  if (!isRecord(body)) return null;

  const areas = parseArray(body.areas, parseTemplateGroup);
  if (areas === null || !isRecord(body.custom)) return null;

  const kinds = parseArray(body.custom.kinds, (kind) => (isMember(GOAL_KINDS, kind) ? kind : null));
  const defaultSize = body.custom.defaultSize;
  if (kinds === null || !isMember(GOAL_SIZES, defaultSize)) return null;

  return { areas, custom: { kinds, defaultSize } };
}

function parseLayoutTile(value: unknown): GoalLayoutTile | null {
  if (!isRecord(value)) return null;

  const { id, sortOrder, size } = value;
  if (typeof id !== 'string' || !isFiniteNumber(sortOrder)) return null;
  if (!isMember(GOAL_SIZES, size)) return null;

  return { id, sortOrder, size };
}

function parseLayoutResponse(body: unknown): LayoutResponse | null {
  if (!isRecord(body)) return null;

  const tiles = parseArray(body.tiles, parseLayoutTile);
  return tiles === null ? null : { tiles };
}

function parseCompletionResponse(body: unknown): CompletionResponse | null {
  if (!isRecord(body) || typeof body.created !== 'boolean') return null;

  const entry = parseEntry(body.entry);
  const goal = parseGoal(body.goal);
  return entry === null || goal === null ? null : { created: body.created, entry, goal };
}

const UNDO_ACTIONS: Readonly<Record<UndoCompletionResponse['action'], true>> = {
  restored: true,
  deleted: true,
  noop: true,
};

function parseUndoResponse(body: unknown): UndoCompletionResponse | null {
  if (!isRecord(body) || !isMember(UNDO_ACTIONS, body.action)) return null;

  const entry = parseEntry(body.entry);
  const goal = parseGoal(body.goal);
  return entry === null || goal === null ? null : { action: body.action, entry, goal };
}

function parseMeasurement(value: unknown): Measurement | null {
  if (!isRecord(value)) return null;

  const { id, goalId, occurredOn, value: amount, note } = value;
  const { calendarEntryId, createdAt, updatedAt } = value;
  if (typeof id !== 'string' || typeof goalId !== 'string') return null;
  if (typeof occurredOn !== 'string' || !isFiniteNumber(amount)) return null;
  if (!isNullableString(note) || !isNullableString(calendarEntryId)) return null;
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') return null;

  return { id, goalId, occurredOn, value: amount, note, calendarEntryId, createdAt, updatedAt };
}

function parseMeasurementResponse(body: unknown): MeasurementResponse | null {
  if (!isRecord(body)) return null;

  const measurement = parseMeasurement(body.measurement);
  const goal = parseGoal(body.goal);
  return measurement === null || goal === null ? null : { measurement, goal };
}

function parseDeleteMeasurementResponse(body: unknown): DeleteMeasurementResponse | null {
  if (!isRecord(body)) return null;

  const goal = parseGoal(body.goal);
  return goal === null ? null : { goal };
}

function parseRecurrence(value: unknown): Recurrence | null {
  if (!isRecord(value)) return null;

  const { id, goalId, freq, interval, byWeekday, startDate, untilDate } = value;
  const { startTime, endTime, timeZone, generatedThrough, isActive } = value;
  const { createdAt, updatedAt } = value;
  if (typeof id !== 'string' || typeof goalId !== 'string') return null;
  if (!isMember(RECURRENCE_FREQS, freq) || !isFiniteNumber(interval)) return null;
  if (typeof startDate !== 'string' || !isNullableString(untilDate)) return null;
  if (!isNullableString(startTime) || !isNullableString(endTime)) return null;
  if (typeof timeZone !== 'string' || !isNullableString(generatedThrough)) return null;
  if (typeof isActive !== 'boolean') return null;
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') return null;

  let days: number[] | null = null;
  if (byWeekday !== null) {
    days = parseArray(byWeekday, (day) => (isFiniteNumber(day) ? day : null));
    if (days === null) return null;
  }

  return {
    id,
    goalId,
    freq,
    interval,
    byWeekday: days,
    startDate,
    untilDate,
    startTime,
    endTime,
    timeZone,
    generatedThrough,
    isActive,
    createdAt,
    updatedAt,
  };
}

function parseOccurrenceChange(value: unknown): OccurrenceChange | null {
  if (!isRecord(value)) return null;

  const { removed, created } = value;
  if (!isFiniteNumber(removed) || !isFiniteNumber(created)) return null;

  return { removed, created };
}

function parseRecurrenceResponse(body: unknown): RecurrenceResponse | null {
  if (!isRecord(body)) return null;

  const recurrence = parseRecurrence(body.recurrence);
  const occurrences = parseOccurrenceChange(body.occurrences);
  return recurrence === null || occurrences === null ? null : { recurrence, occurrences };
}

function parseRecurrencesResponse(body: unknown): RecurrencesResponse | null {
  if (!isRecord(body)) return null;

  const recurrences = parseArray(body.recurrences, parseRecurrence);
  return recurrences === null ? null : { recurrences };
}

function parseDeleteRecurrenceResponse(body: unknown): DeleteRecurrenceResponse | null {
  if (!isRecord(body) || typeof body.id !== 'string') return null;
  if (!isRecord(body.occurrences)) return null;

  const { removed, kept } = body.occurrences;
  if (!isFiniteNumber(removed) || !isFiniteNumber(kept)) return null;

  return { id: body.id, occurrences: { removed, kept } };
}

interface ParsedError {
  error: string;
  message: string | null;
  field: string | null;
  reason: unknown;
  missing: readonly string[];
  limit: string | null;
  retryAfterSeconds: number | null;
}

function parseApiError(body: unknown): ParsedError | null {
  if (!isRecord(body)) return null;

  const { error, message, reason, missing, field, limit, retryAfterSeconds } = body;
  if (typeof error !== 'string') return null;

  return {
    error,
    message: typeof message === 'string' ? message : null,
    field: typeof field === 'string' ? field : null,
    reason,
    missing: parseStringArray(missing),
    limit: typeof limit === 'string' ? limit : null,
    retryAfterSeconds: isFiniteNumber(retryAfterSeconds) ? retryAfterSeconds : null,
  };
}

// --- Requests ---------------------------------------------------------------------------------

/**
 * A status code and a body, as one of the result's non-ok branches.
 *
 * Each status gets its own branch rather than collapsing into "something went wrong", because the
 * screens say genuinely different things: a 401 means sign in again, a 409 is a cap that is not a
 * failure, and a 404 on an undo means "already gone" and is treated as success by the caller.
 */
function toFailure(status: number, body: unknown): ApiFailure {
  const parsed = parseApiError(body);

  if (status === 401) {
    const reason = parsed !== null && isMember(AUTH_REASONS, parsed.reason) ? parsed.reason : null;
    return { kind: 'unauthenticated', reason };
  }
  if (status === 429) {
    return { kind: 'throttled', retryAfterSeconds: parsed?.retryAfterSeconds ?? null };
  }
  if (status === 404 && parsed !== null) {
    const reason = isMember(NOT_FOUND_REASONS, parsed.reason) ? parsed.reason : null;
    return { kind: 'missing', reason };
  }
  if (status === 409 && parsed !== null) {
    const reason = isMember(CONFLICT_REASONS, parsed.reason) ? parsed.reason : null;
    return { kind: 'conflict', error: parsed.error, reason, limit: parsed.limit };
  }
  if (status === 503 && parsed !== null) {
    // A 503 without a reason still means the read could not be served; say the general thing.
    const reason = isMember(UNAVAILABLE_REASONS, parsed.reason) ? parsed.reason : 'upstream_error';
    return { kind: 'unavailable', reason, missing: parsed.missing };
  }
  if (status === 400 && parsed !== null) {
    return { kind: 'rejected', error: parsed.error, message: parsed.message, field: parsed.field };
  }
  return { kind: 'failed', reason: 'http', status };
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RequestSpec<T> {
  path: string;
  method?: HttpMethod;
  /** Serialised as JSON. Absent means no body and no content-type, which a GET requires. */
  body?: unknown;
  parse: (body: unknown) => T | null;
}

async function request<T>(
  { path, method = 'GET', body: payload, parse }: RequestSpec<T>,
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch, accessToken }: ApiRequestOptions,
): Promise<ApiResult<T>> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const headers: Record<string, string> = { accept: 'application/json' };
  // The one line that makes every route in this file work: the caller's own identity.
  if (accessToken !== undefined) headers.authorization = `Bearer ${accessToken}`;
  if (payload !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetchImpl(apiUrl(path), {
      method,
      signal: combined,
      headers,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
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
    // A non-JSON body (an HTML error page, an empty 503, a 204) is handled below.
  }

  if (!response.ok) {
    return toFailure(response.status, body);
  }

  const data = parse(body);
  return data === null
    ? { kind: 'failed', reason: 'malformed', status: response.status }
    : { kind: 'ok', data };
}

/** A 204 with nothing to read. `null` is the whole payload. */
function parseNoContent(): Record<string, never> {
  return {};
}

/**
 * GET /api/goals — goals in canvas order.
 *
 * With no statuses that is the active board; `['completed', 'archived']` is "My full glasses".
 */
export function fetchGoals(
  options: ApiRequestOptions = {},
  statuses?: readonly GoalStatus[],
): Promise<ApiResult<GoalsResponse>> {
  const suffix =
    statuses === undefined || statuses.length === 0 ? '' : `?status=${statuses.join(',')}`;
  return request({ path: `/api/goals${suffix}`, parse: parseGoalsResponse }, options);
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
  const path = `/api/calendar?${query.toString()}`;
  return request({ path, parse: parseCalendarResponse }, options);
}

/** GET /api/areas — the six life areas, in legend order. */
export function fetchAreas(options: ApiRequestOptions = {}): Promise<ApiResult<AreasResponse>> {
  return request({ path: '/api/areas', parse: parseAreasResponse }, options);
}

/** GET /api/goal-templates — the catalogue, grouped by area, plus the custom block. */
export function fetchGoalTemplates(
  options: ApiRequestOptions = {},
): Promise<ApiResult<GoalTemplatesResponse>> {
  return request({ path: '/api/goal-templates', parse: parseTemplatesResponse }, options);
}

/** GET /api/session — the zone, the week start, and when an unused account lapses. */
export function fetchSession(options: ApiRequestOptions = {}): Promise<ApiResult<SessionResponse>> {
  return request({ path: '/api/session', parse: parseSessionResponse }, options);
}

/** PATCH /api/session — the browser's own zone on a first run, or a changed week start. */
export function updateSession(
  body: UpdateSessionRequest,
  options: ApiRequestOptions = {},
): Promise<ApiResult<SessionResponse>> {
  return request(
    { path: '/api/session', method: 'PATCH', body, parse: parseSessionResponse },
    options,
  );
}

// --- Writes -----------------------------------------------------------------------------------

/*
 * Every write below answers with the recomputed goal, and the callers use it.
 *
 * That is the whole reason a tile can fill from a tap without refetching the board: the fraction
 * in the response was computed by goal_dashboard, so it cannot disagree with the one the next
 * GET /api/goals would produce. Nothing in this file does arithmetic on progress, and nothing
 * above it should either.
 */

/** POST /api/goals — plain fields. A template is a source of defaults and is never named here. */
export function createGoal(
  body: CreateGoalRequest,
  options: ApiRequestOptions = {},
): Promise<ApiResult<GoalResponse>> {
  return request({ path: '/api/goals', method: 'POST', body, parse: parseGoalResponse }, options);
}

/** PATCH /api/goals/:goalId — an edit, or the status change that fills a glass away. */
export function updateGoal(
  goalId: string,
  body: UpdateGoalRequest,
  options: ApiRequestOptions = {},
): Promise<ApiResult<GoalResponse>> {
  const path = `/api/goals/${encodeURIComponent(goalId)}`;
  return request({ path, method: 'PATCH', body, parse: parseGoalResponse }, options);
}

/** DELETE /api/goals/:goalId. A 404 arrives as `missing`, which callers read as "already gone". */
export function deleteGoal(
  goalId: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<Record<string, never>>> {
  const path = `/api/goals/${encodeURIComponent(goalId)}`;
  return request({ path, method: 'DELETE', parse: parseNoContent }, options);
}

/**
 * PATCH /api/goals/layout — one whole drag or resize, in one request.
 *
 * Batched on purpose: a gesture that moved four tiles is four rows in one body, not four requests
 * against a 60-a-minute write quota. All or nothing, so a rejected batch means the board goes
 * back to where it was rather than half-moving.
 */
export function updateLayout(
  body: UpdateLayoutRequest,
  options: ApiRequestOptions = {},
): Promise<ApiResult<LayoutResponse>> {
  const spec = {
    path: '/api/goals/layout',
    method: 'PATCH' as const,
    body,
    parse: parseLayoutResponse,
  };
  return request(spec, options);
}

/** POST /api/goals/:goalId/completions — the tick. Idempotent per day. */
export function completeOccurrence(
  goalId: string,
  body: CompleteOccurrenceRequest = {},
  options: ApiRequestOptions = {},
): Promise<ApiResult<CompletionResponse>> {
  const path = `/api/goals/${encodeURIComponent(goalId)}/completions`;
  return request({ path, method: 'POST', body, parse: parseCompletionResponse }, options);
}

/** DELETE /api/goals/:goalId/completions/:entryId — one tap back, no confirmation. */
export function undoCompletion(
  goalId: string,
  entryId: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<UndoCompletionResponse>> {
  const goal = encodeURIComponent(goalId);
  const path = `/api/goals/${goal}/completions/${encodeURIComponent(entryId)}`;
  return request({ path, method: 'DELETE', parse: parseUndoResponse }, options);
}

/** POST /api/goals/:goalId/measurements — a weight cannot be ticked, so it is logged. */
export function logMeasurement(
  goalId: string,
  body: LogMeasurementRequest,
  options: ApiRequestOptions = {},
): Promise<ApiResult<MeasurementResponse>> {
  const path = `/api/goals/${encodeURIComponent(goalId)}/measurements`;
  return request({ path, method: 'POST', body, parse: parseMeasurementResponse }, options);
}

/** PATCH /api/goals/:goalId/measurements/:id — correcting a number that was already logged. */
export function updateMeasurement(
  goalId: string,
  measurementId: string,
  body: UpdateMeasurementRequest,
  options: ApiRequestOptions = {},
): Promise<ApiResult<MeasurementResponse>> {
  const goal = encodeURIComponent(goalId);
  const path = `/api/goals/${goal}/measurements/${encodeURIComponent(measurementId)}`;
  return request({ path, method: 'PATCH', body, parse: parseMeasurementResponse }, options);
}

/** DELETE /api/goals/:goalId/measurements/:id — taking a check-in back. */
export function deleteMeasurement(
  goalId: string,
  measurementId: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<DeleteMeasurementResponse>> {
  const goal = encodeURIComponent(goalId);
  const path = `/api/goals/${goal}/measurements/${encodeURIComponent(measurementId)}`;
  return request({ path, method: 'DELETE', parse: parseDeleteMeasurementResponse }, options);
}

/** POST /api/goals/:goalId/recurrences — target days and times. */
/**
 * GET /api/goals/:goalId/recurrences — the rules this goal already has.
 *
 * The editor needs this to replace a rule: a goal's occurrences may all sit outside the window the
 * dashboard fetched, so looking for one there finds nothing and silently offers to create a second.
 */
export function fetchRecurrences(
  goalId: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<RecurrencesResponse>> {
  const path = `/api/goals/${encodeURIComponent(goalId)}/recurrences`;
  return request({ path, parse: parseRecurrencesResponse }, options);
}

export function createRecurrence(
  goalId: string,
  body: RecurrenceInput,
  options: ApiRequestOptions = {},
): Promise<ApiResult<RecurrenceResponse>> {
  const path = `/api/goals/${encodeURIComponent(goalId)}/recurrences`;
  return request({ path, method: 'POST', body, parse: parseRecurrenceResponse }, options);
}

/** PUT /api/goals/:goalId/recurrences/:id — rules are replaced whole, never patched. */
export function replaceRecurrence(
  goalId: string,
  recurrenceId: string,
  body: RecurrenceInput,
  options: ApiRequestOptions = {},
): Promise<ApiResult<RecurrenceResponse>> {
  const goal = encodeURIComponent(goalId);
  const path = `/api/goals/${goal}/recurrences/${encodeURIComponent(recurrenceId)}`;
  return request({ path, method: 'PUT', body, parse: parseRecurrenceResponse }, options);
}

/** DELETE /api/goals/:goalId/recurrences/:id — what already happened is kept. */
export function deleteRecurrence(
  goalId: string,
  recurrenceId: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<DeleteRecurrenceResponse>> {
  const goal = encodeURIComponent(goalId);
  const path = `/api/goals/${goal}/recurrences/${encodeURIComponent(recurrenceId)}`;
  return request({ path, method: 'DELETE', parse: parseDeleteRecurrenceResponse }, options);
}
