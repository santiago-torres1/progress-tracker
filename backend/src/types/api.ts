import type {
  EntryStatus,
  GoalKind,
  GoalSize,
  GoalStatus,
  HabitPeriod,
  ProgressBasis,
} from './database.js';

/*
 * The read-only API contract for v0.1.1-alpha.
 *
 * This is the shared shape: the backend produces it and the frontend will import it verbatim
 * rather than redeclaring it. Two rules keep it honest.
 *
 * 1. It is shaped for the UI, not for the database. camelCase, no `user_id`, numbers as
 *    numbers, `date` as `YYYY-MM-DD`, instants as ISO-8601 `…Z`.
 * 2. It contains no computation. Every progress figure, period boundary and minimum below is
 *    lifted straight out of public.goal_dashboard, which computes them in SQL. If a tile needs
 *    a number the API does not have, the view gains a column — the backend does not do
 *    arithmetic behind the view's back.
 */

export type { EntryStatus, GoalKind, GoalSize, GoalStatus, HabitPeriod, ProgressBasis };

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

/**
 * How full the ring is, and what rule produced it, so the UI can label it honestly instead of
 * pretending the three kinds mean the same thing.
 *
 * `fraction` is null exactly when `basis` is `'none'`: an open-ended scheduled goal with
 * nothing due yet has no denominator, and the tile should show its session count rather than
 * a 0% ring.
 */
export interface GoalProgress {
  basis: ProgressBasis;
  fraction: number | null;
}

/**
 * A habit's current period.
 *
 * The target and the minimum are reported side by side, both already resolved by SQL, so a
 * tile never computes "am I failing" — and cannot, because there is nothing here to compute it
 * from. `minimumMet` is the owner's rule ("as long as you do it once, the app is on your
 * side"), and `minimumMet: false` is *not* a failure state: it means the copy should be "one
 * is still enough this week", never "you missed". Above the minimum nothing is ever a failure.
 *
 * Note this object exists only on `kind: 'habit'` goals, so `minimumMet` is always a real
 * boolean. The view's `period_minimum_met` is NULL for the other kinds, and a nullable boolean
 * on every tile is exactly the shape that invites `if (!goal.minimumMet) renderFailure()`.
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
  /** The canvas is unsorted, but a layout has to be deterministic: ordered by sortOrder, then createdAt. */
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
 * A union rather than one wide object with everything nullable: the tile component switches on
 * `kind`, and inside each branch the fields for that kind are non-null by construction. There
 * is no `goal.habit` to read on a measured goal, and no null-vs-false ambiguity to misread.
 */
export type GoalSummary =
  | (GoalBase & { kind: 'habit'; habit: HabitState })
  | (GoalBase & { kind: 'measured'; measured: MeasuredState })
  | (GoalBase & { kind: 'scheduled'; scheduled: ScheduledState });

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
 * The database guarantees `start_at` and `end_at` are both set or both NULL
 * (`calendar_entries_timing_paired`). The discriminant lifts that guarantee into the type
 * system: `entry.timing === 'timed'` narrows both fields to `string` at once, where checking
 * `startAt !== null` would narrow only one and leave the other nullable in the branch that
 * needs it. Timed and untimed entries render completely differently, so the check that picks
 * the renderer should be the same check that types it.
 */
export type CalendarEntry =
  | (CalendarEntryBase & { timing: 'timed'; startAt: string; endAt: string })
  | (CalendarEntryBase & { timing: 'untimed'; startAt: null; endAt: null });

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
export type UnavailableReason =
  | 'missing_env' // Supabase is not configured on this instance
  | 'invalid_config' // env vars present but unusable
  | 'timeout' // no answer within the route's budget
  | 'upstream_error'; // Supabase answered with an error, or sent an unexpected shape

export interface ApiErrorResponse {
  error: string;
  /** Present on 400s: says what was wrong with the request. Never echoes anything upstream. */
  message?: string;
  /** Present on 503s. */
  reason?: UnavailableReason;
  /** Present when `reason` is `missing_env`: the names of the unset variables, never values. */
  missing?: string[];
}
