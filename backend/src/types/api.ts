import type {
  EntryStatus,
  GoalKind,
  GoalSize,
  GoalStatus,
  HabitPeriod,
  ProgressBasis,
  RecurrenceFreq,
} from './database.js';

/*
 * The product API contract.
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

export type {
  EntryStatus,
  GoalKind,
  GoalSize,
  GoalStatus,
  HabitPeriod,
  ProgressBasis,
  RecurrenceFreq,
};

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

// --- The goal catalogue ----------------------------------------------------------------------

/*
 * A template is a STARTING POINT, never a contract.
 *
 * Nothing a template suggests binds the goal that comes out of it: the fields below seed a form,
 * the person edits whatever they like, and POST /api/goals is sent plain fields with no mention
 * of a template. There is deliberately no `templateId` in any request or response here, and no
 * column behind one — so editing a template later cannot reach into somebody's goal, and no
 * field can be read-only because of where its value came from.
 *
 * That is also what makes "Something else" ordinary rather than special: a custom goal is the
 * same POST with nothing pre-filled. See GoalTemplatesResponse.
 */
interface GoalTemplateBase {
  id: string;
  /** Stable machine name (`move-your-body`), for keying an illustration. Never stored on a goal. */
  slug: string;
  title: string;
  /** The area this template is filed under; the full area is on its GoalTemplateGroup. */
  areaId: string;
  sortOrder: number;
  /**
   * A cadence for the recurrence editor — "repeats weekly" — not a field of the goal, and null
   * when the template has no opinion. Weekdays are absent on purpose: which days somebody runs
   * is not something a catalogue can guess, and a weekly rule needs real days before it saves.
   */
  repeat: { freq: RecurrenceFreq; interval: number } | null;
}

/**
 * One suggestion, discriminated on `kind` exactly like GoalSummary, so the picker and the tile
 * switch on the same field.
 *
 * Habit suggestions are always complete (a habit with no period is not storable, here or on a
 * goal); measured and scheduled suggestions are nullable because "Reach a weight" genuinely does
 * not know which weight, and NULL says "you supply this" rather than inventing a zero.
 */
export type GoalTemplate =
  | (GoalTemplateBase & {
      kind: 'habit';
      habit: { targetCount: number; minimumCount: number; period: HabitPeriod };
    })
  | (GoalTemplateBase & {
      kind: 'measured';
      measured: { unit: string | null; startValue: number | null; targetValue: number | null };
    })
  | (GoalTemplateBase & { kind: 'scheduled'; scheduled: { targetSessions: number | null } });

/** One area and the templates filed under it. Present even when `templates` is empty. */
export interface GoalTemplateGroup {
  area: LifeArea;
  templates: GoalTemplate[];
}

// --- Write requests --------------------------------------------------------------------------

/** The fields every goal has, whatever its kind. */
interface GoalCoreInput {
  title: string;
  description?: string | null;
  /** Tile size: the owner's statement of importance. Defaults to `medium`. */
  size?: GoalSize;
  lifeAreaId?: string | null;
  /** `#RRGGBB`; wins over the area's colour. */
  colorOverride?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
  sortOrder?: number;
}

/** `minimumCount` defaults to 1 in the database, which is what makes a new habit encouraging. */
export interface HabitInput {
  targetCount: number;
  minimumCount?: number;
  period: HabitPeriod;
}

/** Direction is derived from the two values; they may not be equal. */
export interface MeasuredInput {
  unit?: string | null;
  startValue: number;
  targetValue: number;
}

/** `targetSessions: null` (or absent) means open-ended, and progress reports adherence. */
export interface ScheduledInput {
  targetSessions?: number | null;
}

/**
 * POST /api/goals. Discriminated on `kind`, so the fields a kind requires are required.
 *
 * There is no `userId` and no `status`: ownership comes from the caller's session, and a goal
 * starts active. There is no `templateId` either — see GoalTemplate.
 */
export type CreateGoalRequest =
  | (GoalCoreInput & { kind: 'habit'; habit: HabitInput })
  | (GoalCoreInput & { kind: 'measured'; measured: MeasuredInput })
  | (GoalCoreInput & { kind: 'scheduled'; scheduled: ScheduledInput });

/**
 * PATCH /api/goals/:goalId. Every field is optional; an absent field is left alone.
 *
 * `kind` cannot change — it decides which columns a goal is allowed to carry, and changing it
 * would invalidate the history already hanging off the goal. Send at most one kind block, and
 * it must be the goal's own kind; anything else is refused.
 *
 * `status` is how a finished goal reaches "My full glasses": `completed`, then `archived` if it
 * is being filed away. `completedAt` and `archivedAt` are stamped by the database, and a goal
 * archived after being completed keeps the moment it was finished.
 */
export interface UpdateGoalRequest {
  title?: string;
  description?: string | null;
  size?: GoalSize;
  lifeAreaId?: string | null;
  colorOverride?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
  sortOrder?: number;
  status?: GoalStatus;
  habit?: Partial<HabitInput>;
  measured?: Partial<MeasuredInput>;
  scheduled?: ScheduledInput;
}

/** One tile's new place on the canvas. Omitting a field leaves it as it is. */
export interface GoalLayoutInput {
  id: string;
  sortOrder?: number;
  size?: GoalSize;
}

/**
 * PATCH /api/goals/layout — a whole drag in one request.
 *
 * All or nothing: if any id in the batch is not a goal the caller owns, nothing is applied and
 * the response is 404. A board is never left half-reordered.
 */
export interface UpdateLayoutRequest {
  tiles: GoalLayoutInput[];
}

/** One tile as it now stands. */
export interface GoalLayoutTile {
  id: string;
  sortOrder: number;
  size: GoalSize;
}

/**
 * POST /api/goals/:goalId/completions — "I did it."
 *
 * With neither field, it means today, in the caller's own time zone. `date` records a different
 * day; `entryId` names one specific occurrence, which is what the calendar sends when a day
 * holds more than one.
 */
export interface CompleteOccurrenceRequest {
  date?: string;
  entryId?: string;
}

/** POST /api/goals/:goalId/measurements — the value on a day. Absent `occurredOn` means today. */
export interface LogMeasurementRequest {
  value: number;
  occurredOn?: string;
  note?: string | null;
}

/** PATCH /api/goals/:goalId/measurements/:measurementId — correct one that is already logged. */
export interface UpdateMeasurementRequest {
  value?: number;
  occurredOn?: string;
  note?: string | null;
}

/**
 * A repeat rule, as sent. Rules are replaced whole rather than patched: the editor holds the
 * entire rule anyway, and "does an absent `untilDate` mean unchanged or cleared?" has two
 * plausible answers, which is one too many.
 *
 * `startTime`/`endTime` are local wall clock (`HH:MM` or `HH:MM:SS`) and are meaningless without
 * `timeZone`, which defaults to the caller's own. That pairing is what keeps a 19:00 session at
 * 19:00 across a daylight-saving change.
 */
export interface RecurrenceInput {
  freq: RecurrenceFreq;
  /** Every N periods. Defaults to 1. */
  interval?: number;
  /** ISO weekdays, 1 = Monday. Required for `weekly`, forbidden otherwise. */
  byWeekday?: number[] | null;
  startDate: string;
  /** Null means "no end date", which is only real as far as it has been materialised. */
  untilDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  timeZone?: string | null;
  /** False pauses the rule: its future plan is dropped and nothing new is materialised. */
  isActive?: boolean;
}

// --- Write responses -------------------------------------------------------------------------

/** A numeric check-in against a measured goal. */
export interface Measurement {
  id: string;
  goalId: string;
  occurredOn: string;
  value: number;
  note: string | null;
  /** Set when the check-in was logged from a calendar entry. */
  calendarEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A repeat rule as stored, including how far it has been materialised. */
export interface Recurrence {
  id: string;
  goalId: string;
  freq: RecurrenceFreq;
  interval: number;
  byWeekday: number[] | null;
  startDate: string;
  untilDate: string | null;
  startTime: string | null;
  endTime: string | null;
  timeZone: string;
  generatedThrough: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What a rule change did to the timeline. Completed and hand-edited occurrences are never in it. */
export interface OccurrenceChange {
  /** Future planned occurrences dropped because the rule changed. */
  removed: number;
  /** Occurrences materialised up to the horizon. */
  created: number;
}

// --- Response envelopes ----------------------------------------------------------------------

export interface GoalsResponse {
  goals: GoalSummary[];
}

/** A single goal, as every write that changes one returns it: the tile, already recomputed. */
export interface GoalResponse {
  goal: GoalSummary;
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

/**
 * GET /api/goal-templates.
 *
 * Grouped by area, and EVERY area is present — including one with no templates left. `custom`
 * says the other thing the picker needs: a goal with nothing pre-filled is always available, in
 * every area, and may be any kind. Between them there is nothing for the UI to hardcode and no
 * "Something else" row to special-case.
 */
export interface GoalTemplatesResponse {
  areas: GoalTemplateGroup[];
  custom: {
    kinds: GoalKind[];
    /** What a goal gets when nobody chooses: the database's own default. */
    defaultSize: GoalSize;
  };
}

/** The batch drag, echoed back as it now stands. */
export interface LayoutResponse {
  tiles: GoalLayoutTile[];
}

/**
 * The result of completing an occurrence.
 *
 * `created` says the day held no occurrence and one was made to record this, which is what tells
 * the calendar to insert a row rather than update one. The recomputed `goal` comes back with it
 * so the glass can refill without a second request.
 */
export interface CompletionResponse {
  created: boolean;
  entry: CalendarEntry;
  goal: GoalSummary;
}

/**
 * The result of taking a completion back.
 *
 * - `restored` — the occurrence existed before; it is back to the status it had.
 * - `deleted` — the completion had created it, so it is gone; `entry` is the row as it was, for
 *   a client removing it from a calendar it is holding.
 * - `noop` — it was not completed. A retried undo lands here rather than failing.
 */
export interface UndoCompletionResponse {
  action: 'restored' | 'deleted' | 'noop';
  entry: CalendarEntry;
  goal: GoalSummary;
}

/** A check-in, with the tile it moved. */
export interface MeasurementResponse {
  measurement: Measurement;
  goal: GoalSummary;
}

/** Deleting a check-in returns no check-in — only the tile, which has quietly changed. */
export interface DeleteMeasurementResponse {
  goal: GoalSummary;
}

export interface RecurrenceResponse {
  recurrence: Recurrence;
  occurrences: OccurrenceChange;
}

/** Deleting a rule keeps the occurrences that already happened; `kept` counts them. */
export interface DeleteRecurrenceResponse {
  id: string;
  occurrences: { removed: number; kept: number };
}

/** Why a read could not be served. Short codes only: never an upstream message. */
export type UnavailableReason =
  | 'missing_env' // Supabase is not configured on this instance
  | 'invalid_config' // env vars present but unusable
  | 'timeout' // no answer within the route's budget
  | 'upstream_error'; // Supabase answered with an error, or sent an unexpected shape

/**
 * Why a caller could not be identified. Short codes only.
 *
 * The first two describe the request and the caller can act on them. The last two deliberately
 * do not distinguish "expired" from "forged" from "unknown subject": telling an attacker which
 * of those they hit tells them how to get closer.
 */
export type AuthReason =
  | 'missing_token' // no Authorization header
  | 'malformed_token' // present, but not `Bearer <jwt>`
  | 'invalid_token' // Supabase would not accept it
  | 'no_profile'; // accepted, but it maps to no account here

/**
 * What a write could not find, on a 404.
 *
 * "Not found" also covers "not yours", and deliberately does not say which: row-level security
 * makes another session's rows invisible, so the two are the same fact from here, and telling
 * them apart would confirm that an id exists.
 */
export type NotFoundReason = 'goal' | 'entry' | 'recurrence' | 'measurement';

/**
 * Why a write conflicted with the state it found. Short codes, never an upstream message.
 *
 * - `wrong_goal_kind` — a check-in against a goal that is not measured.
 * - `duplicate` — a row like that already exists (correcting a check-in onto a day that has one).
 */
export type ConflictReason = 'wrong_goal_kind' | 'duplicate';

export interface ApiErrorResponse {
  error: string;
  /** Present on 400s: says what was wrong with the request. Never echoes anything upstream. */
  message?: string;
  /** Present on 400s when one field is at fault, named as the request spells it. */
  field?: string;
  /** Present on 401s, 404s, 409s and 503s. */
  reason?: UnavailableReason | AuthReason | NotFoundReason | ConflictReason;
  /** Present when `reason` is `missing_env`: the names of the unset variables, never values. */
  missing?: string[];
  /**
   * Present on 409 `limit_reached`: which built-in cap was hit, e.g. `goals_per_user`. It is one
   * of a fixed set of names this API defines, never text from the database.
   */
  limit?: string;
  /** Present on 429s, mirroring the Retry-After header. */
  retryAfterSeconds?: number;
}
