/*
 * The read-only API contract, as the UI sees it.
 *
 * ---------------------------------------------------------------------------------------------
 * THIS FILE MIRRORS backend/src/types/api.ts. KEEP THE TWO IN STEP.
 *
 * It is a copy rather than an import because `frontend/` and `backend/` are independent npm
 * packages with their own tsconfigs — a relative import across the boundary would drag the
 * backend's compilation into the frontend build. Field names, nullability and the two
 * discriminated unions are reproduced exactly; nothing is renamed, added or widened. The only
 * additions are `TimedEntry` and `UntimedEntry`, two aliases derived from `CalendarEntry` for
 * code that has already picked a branch. If the backend contract changes, change this file in
 * the same PR.
 * ---------------------------------------------------------------------------------------------
 *
 * Two rules the backend keeps, which the components rely on:
 *
 * 1. It is shaped for the UI, not for the database: camelCase, numbers as numbers, `date` as
 *    `YYYY-MM-DD`, instants as ISO-8601 `…Z`.
 * 2. It contains no computation. Every progress figure, period boundary and minimum is lifted
 *    straight out of the SQL view. A component renders those numbers; it does not recompute
 *    them, and there is deliberately nothing here from which to compute a failure.
 */

// --- Enums -----------------------------------------------------------------------------------

export type GoalKind = 'scheduled' | 'measured' | 'habit';
export type GoalStatus = 'active' | 'paused' | 'completed' | 'archived';
export type GoalSize = 'small' | 'medium' | 'large';
export type HabitPeriod = 'day' | 'week' | 'month';
export type EntryStatus = 'planned' | 'completed' | 'skipped' | 'cancelled';
export type ProgressBasis =
  'measured_value' | 'period_completion' | 'session_target' | 'session_adherence' | 'none';

// --- Life areas ------------------------------------------------------------------------------

/** A life area as a goal or calendar entry refers to it. The effective colour lives on the goal. */
export interface GoalArea {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
}

/** A life area in its own right, for the dashboard key. */
export interface LifeArea extends GoalArea {
  /** Light-theme hex, `#RRGGBB`. The frontend derives the dark-theme colour from `slug`. */
  color: string;
  sortOrder: number;
  /** True for the six built-in areas, which every user sees. */
  isSystem: boolean;
}

// --- Goals -----------------------------------------------------------------------------------

/**
 * How full the glass is, and what rule produced it.
 *
 * `fraction` is null exactly when `basis` is `'none'`: an open-ended scheduled goal with nothing
 * due yet has no denominator, and the tile shows its session count rather than a 0% glass.
 */
export interface GoalProgress {
  basis: ProgressBasis;
  fraction: number | null;
}

/**
 * A habit's current period.
 *
 * The target and the minimum arrive side by side, already resolved, so a tile never computes
 * "am I failing" — and cannot. `minimumMet: false` is *not* a failure state: it means the copy
 * reads "one is still enough this week", never "you missed".
 */
export interface HabitState {
  period: HabitPeriod;
  /** Inclusive bounds of the current period, honouring the user's week start. */
  periodStart: string;
  periodEnd: string;
  completedCount: number;
  /** What they are aiming for. `GoalProgress.fraction` is completedCount / targetCount. */
  targetCount: number;
  /** The floor that still counts as keeping the habit. 1 <= minimumCount <= targetCount. */
  minimumCount: number;
  /** completedCount / minimumCount, clamped to 1. Reaches 1 exactly when `minimumMet` flips. */
  minimumFraction: number;
  minimumMet: boolean;
}

/** A measured goal's numbers. Direction is derived from startValue vs targetValue, never stored. */
export interface MeasuredState {
  unit: string | null;
  startValue: number;
  targetValue: number;
  /** Latest check-in, or `startValue` when there has not been one. */
  currentValue: number;
  lastMeasuredOn: string | null;
  /** The check-in before the latest, so a tile can say "up 0.7 kg since the 3rd" calmly. */
  previousValue: number | null;
  previousMeasuredOn: string | null;
}

/** A scheduled goal's session counts. `targetSessions: null` means open-ended. */
export interface ScheduledState {
  targetSessions: number | null;
  plannedCount: number;
  completedCount: number;
  /** Occurrences whose date has arrived; the denominator behind `session_adherence`. */
  dueCount: number;
}

interface GoalBase {
  id: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  /** Tile size on the canvas. The owner's own statement of importance; never derived. */
  size: GoalSize;
  /** The canvas is unsorted, but a layout has to be deterministic: sortOrder, then createdAt. */
  sortOrder: number;
  area: GoalArea | null;
  /** Effective colour, already resolved: override -> area colour -> neutral fallback. */
  color: string;
  startDate: string | null;
  targetDate: string | null;
  progress: GoalProgress;
  /** The later of the last completed occurrence and the last check-in. */
  lastProgressOn: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One dashboard tile, discriminated on `kind`.
 *
 * A union rather than one wide object with everything nullable: the tile switches on `kind`, and
 * inside each branch the fields for that kind are non-null by construction.
 */
export type GoalSummary =
  | (GoalBase & { kind: 'habit'; habit: HabitState })
  | (GoalBase & { kind: 'measured'; measured: MeasuredState })
  | (GoalBase & { kind: 'scheduled'; scheduled: ScheduledState });

// --- Calendar --------------------------------------------------------------------------------

/** As much of a calendar entry's goal as rendering it needs — no second request. */
export interface CalendarEntryGoal {
  id: string;
  title: string;
  kind: GoalKind;
  /** Effective colour, resolved in SQL exactly as on the dashboard. */
  color: string;
  area: GoalArea | null;
}

interface CalendarEntryBase {
  id: string;
  /** Local calendar day, `YYYY-MM-DD`. Always present, timed or not. */
  date: string;
  /** IANA zone the entry was authored in. */
  timeZone: string;
  /** The entry's own title, falling back to its goal's. Null only for an untitled goal-less item. */
  title: string | null;
  notes: string | null;
  status: EntryStatus;
  completedAt: string | null;
  /** Set when this occurrence came from a repeat rule, so the UI can mark it as part of a series. */
  recurrenceId: string | null;
  /** Null for a plain calendar item that drives no goal (a dentist appointment, a birthday). */
  goal: CalendarEntryGoal | null;
}

/**
 * One calendar occurrence, discriminated on `timing`.
 *
 * `entry.timing === 'timed'` narrows `startAt` and `endAt` to `string` at once. Timed and
 * untimed entries render completely differently, so the check that picks the renderer is the
 * same check that types it.
 */
export type CalendarEntry =
  | (CalendarEntryBase & { timing: 'timed'; startAt: string; endAt: string })
  | (CalendarEntryBase & { timing: 'untimed'; startAt: null; endAt: null });

/** A timed occurrence on its own, for code that has already picked the branch. */
export type TimedEntry = Extract<CalendarEntry, { timing: 'timed' }>;

/** An untimed occurrence on its own. */
export type UntimedEntry = Extract<CalendarEntry, { timing: 'untimed' }>;

// --- Response envelopes ----------------------------------------------------------------------

export interface GoalsResponse {
  goals: GoalSummary[];
}

export interface CalendarResponse {
  /** The validated range, echoed back so a client can match a response to a request. */
  from: string;
  to: string;
  entries: CalendarEntry[];
}

export interface AreasResponse {
  areas: LifeArea[];
}

/** Why a read could not be served. Short codes only: never an upstream message. */
export type UnavailableReason = 'missing_env' | 'invalid_config' | 'timeout' | 'upstream_error';

export interface ApiErrorResponse {
  error: string;
  /** Present on 400s: says what was wrong with the request. Never echoes anything upstream. */
  message?: string;
  /** Present on 503s. */
  reason?: UnavailableReason;
  /** Present when `reason` is `missing_env`: the names of the unset variables, never values. */
  missing?: string[];
}
