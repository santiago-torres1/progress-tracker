/*
 * Narrow, hand-written types for the three read surfaces this API uses.
 *
 * ---------------------------------------------------------------------------------------------
 * TEMPORARY — REPLACE WITH GENERATED TYPES.
 *
 * As soon as the Supabase project is linked, throw this file away and generate the real thing:
 *
 *   supabase gen types typescript --project-id <ref> --schema public > backend/src/types/database.ts
 *
 * then pass `Database` to createClient<Database>() in src/lib/supabase.ts and delete the
 * enum unions below in favour of `Database["public"]["Enums"][…]`. It is hand-written today
 * only because `supabase gen types` needs hosted access, and this repo has none.
 * ---------------------------------------------------------------------------------------------
 *
 * Every column here was checked twice: against supabase/migrations/*.sql, and against a
 * throwaway PostgreSQL 17 container with those migrations plus seed.sql applied. Nothing is
 * guessed. Do not add a column without doing the same.
 *
 * `numeric` columns are typed `number | string` because PostgREST may render either, depending
 * on version and how the value is produced; src/lib/row.ts converts them deliberately.
 */

// --- Enums (public.goal_kind, public.goal_status, …) -----------------------------------------

export const GOAL_KINDS = ['scheduled', 'measured', 'habit'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export const GOAL_STATUSES = ['active', 'paused', 'completed', 'archived'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_SIZES = ['small', 'medium', 'large'] as const;
export type GoalSize = (typeof GOAL_SIZES)[number];

export const HABIT_PERIODS = ['day', 'week', 'month'] as const;
export type HabitPeriod = (typeof HABIT_PERIODS)[number];

export const ENTRY_STATUSES = ['planned', 'completed', 'skipped', 'cancelled'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly'] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];

/**
 * Not a PostgreSQL enum: a `text` CASE in public.goal_progress. The five values are exhaustive
 * over goal_kind, so the view can produce nothing else — see the `progress_basis` expression in
 * 20260916090300_progress_views.sql.
 */
export const PROGRESS_BASES = [
  'measured_value',
  'period_completion',
  'session_target',
  'session_adherence',
  'none',
] as const;
export type ProgressBasis = (typeof PROGRESS_BASES)[number];

// --- public.goal_dashboard -------------------------------------------------------------------

/**
 * The subset of public.goal_dashboard the dashboard endpoint selects.
 *
 * Omitted on purpose: `user_id` (never leaves the server), `completed_at` / `archived_at`
 * (always NULL for the active goals this API returns).
 */
export interface GoalDashboardRow {
  id: string;
  title: string;
  description: string | null;
  kind: GoalKind;
  status: GoalStatus;
  size: GoalSize;
  sort_order: number;

  life_area_id: string | null;
  life_area_slug: string | null;
  life_area_name: string | null;
  life_area_icon: string | null;
  /** coalesce(goals.color_override, life_areas.color, '#64748B') — resolved in SQL. */
  color: string;

  start_date: string | null;
  target_date: string | null;

  // kind = 'measured'. start_value/target_value are NOT NULL for this kind (goals_kind_fields),
  // and current_value is coalesce(latest check-in, start_value), so it is never NULL either.
  measurement_unit: string | null;
  start_value: number | string | null;
  target_value: number | string | null;
  current_value: number | string | null;
  last_measured_on: string | null;
  previous_value: number | string | null;
  previous_measured_on: string | null;

  // kind = 'habit'. All NOT NULL for this kind, NULL for every other kind.
  target_count: number | null;
  minimum_count: number | null;
  habit_period: HabitPeriod | null;
  period_start: string | null;
  period_end: string | null;
  period_completed_count: number | null;
  period_minimum_met: boolean | null;
  period_minimum_fraction: number | string | null;

  // kind = 'scheduled'. target_sessions is NULL for an open-ended goal; the counts are
  // coalesced to 0 in the view and so are never NULL for any kind.
  target_sessions: number | null;
  planned_count: number;
  completed_count: number;
  due_count: number;

  progress_basis: ProgressBasis;
  /** 0..1, or NULL when the goal genuinely has no denominator (progress_basis = 'none'). */
  progress_fraction: number | string | null;
  last_progress_on: string | null;

  created_at: string;
  updated_at: string;
}

// --- public.calendar_entries -----------------------------------------------------------------

/**
 * The subset of public.calendar_entries the calendar endpoint selects.
 *
 * `start_at` and `end_at` are either both set (timed) or both NULL (untimed) — enforced by the
 * calendar_entries_timing_paired CHECK, and the reason the API exposes a `timing` discriminant.
 * Omitted on purpose: `user_id`, and `is_exception` (a write-side concern).
 */
export interface CalendarEntryRow {
  id: string;
  goal_id: string | null;
  recurrence_id: string | null;
  /** NULL means "show the goal's title" (see the column comment in 20260916090100). */
  title: string | null;
  notes: string | null;
  entry_date: string;
  start_at: string | null;
  end_at: string | null;
  time_zone: string;
  status: EntryStatus;
  completed_at: string | null;
}

// --- public.life_areas -----------------------------------------------------------------------

/** The subset of public.life_areas the areas endpoint selects. `user_id` is never exposed. */
export interface LifeAreaRow {
  id: string;
  slug: string;
  name: string;
  /** Light-theme hex, `#RRGGBB`. The frontend derives the dark-theme colour from the slug. */
  color: string;
  icon: string | null;
  sort_order: number;
  /** Generated column: true when user_id IS NULL, i.e. a built-in area shared by everyone. */
  is_system: boolean;
}

// --- public.goal_templates -------------------------------------------------------------------

/**
 * The goal catalogue, as GET /api/goal-templates reads it.
 *
 * Every `suggested_*` column is nullable by design: "Reach a weight" cannot know which weight.
 * NULL means "the person supplies this", which is a different fact from 0. `user_id` does not
 * exist on this table at all — the catalogue is shared reference data, like the six life areas.
 */
export interface GoalTemplateRow {
  id: string;
  life_area_id: string;
  slug: string;
  title: string;
  kind: GoalKind;

  suggested_measurement_unit: string | null;
  suggested_start_value: number | string | null;
  suggested_target_value: number | string | null;

  // NOT NULL for kind = 'habit' (goal_templates_kind_fields), NULL for every other kind.
  suggested_target_count: number | null;
  suggested_minimum_count: number | null;
  suggested_habit_period: HabitPeriod | null;

  suggested_target_sessions: number | null;

  suggested_freq: RecurrenceFreq | null;
  suggested_interval_count: number | null;

  sort_order: number;
}

// --- public.recurrences ----------------------------------------------------------------------

/**
 * A repeat rule, as the write RPCs in 20260918100200 return it.
 *
 * `start_time` / `end_time` are LOCAL wall clock (`HH:MM:SS`) and mean nothing without
 * `time_zone`; see the schema notes on why they are not instants.
 */
export interface RecurrenceRow {
  id: string;
  goal_id: string;
  freq: RecurrenceFreq;
  interval_count: number;
  byweekday: number[] | null;
  start_date: string;
  until_date: string | null;
  start_time: string | null;
  end_time: string | null;
  time_zone: string;
  /** How far occurrences have been materialised. NULL before the first expansion. */
  generated_through: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// --- public.progress_entries -----------------------------------------------------------------

/** A numeric check-in. One per goal per day (progress_entries_goal_day_uidx). */
export interface ProgressEntryRow {
  id: string;
  goal_id: string;
  calendar_entry_id: string | null;
  occurred_on: string;
  value: number | string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// --- public.session_overview -----------------------------------------------------------------

/**
 * The account's own facts, as GET /api/session reads them (20260923100000).
 *
 * Every count is computed by the view, over rows this API never fetches: the backend does no
 * arithmetic behind it, exactly as it does none behind public.goal_dashboard. Row-level security
 * on public.users means a session's query returns one row — its own — so the caller is never
 * named in the query and `user_id` is never selected.
 */
export interface SessionOverviewRow {
  created_at: string;
  /** Whole days from the account's first day to its today, both in the account's zone. 0 on day one. */
  days_since_start: number;
  /** Goals with status 'active': exactly what GET /api/goals returns by default. */
  goals_on_board: number;
  /** Goals with status 'completed' or 'archived'. */
  glasses_filled: number;
  /** Occurrences ticked off, goal-linked or not. */
  completions_recorded: number;
  /** Numeric check-ins logged. */
  measurements_recorded: number;
}
