import { runQuery } from './read.js';
import {
  readBoolean,
  readDate,
  readEnum,
  readInstant,
  readInteger,
  readNumeric,
  readOptionalDate,
  readOptionalInteger,
  readOptionalNumeric,
  readOptionalString,
  readString,
  type UnknownRow,
} from './row.js';
import type { SupabaseUserClient } from './supabase.js';
import {
  GOAL_KINDS,
  GOAL_SIZES,
  GOAL_STATUSES,
  HABIT_PERIODS,
  PROGRESS_BASES,
} from '../types/database.js';
import type { CalendarEntryGoal, GoalArea, GoalStatus, GoalSummary } from '../types/api.js';

/*
 * Reads of public.goal_dashboard.
 *
 * That view is the whole read surface for goals: it already joins the goal to its life area,
 * resolves the effective colour, and computes every progress figure, period boundary and
 * minimum. Nothing below recomputes any of that — this file renames columns and nothing more.
 */

/**
 * Exactly the columns the dashboard needs, named so the query is greppable and can be run
 * verbatim against a real database (it has been: see the psql verification in the PR notes).
 *
 * `user_id` is deliberately absent — it is neither selected nor filtered on. Row-level
 * security scopes the view to the caller (goal_dashboard is security_invoker, so the policies on
 * public.goals apply through it), and adding a redundant `user_id = …` filter on top would hide
 * a broken policy from the isolation test rather than defend against one.
 * `completed_at` / `archived_at` are absent because this endpoint returns active goals only.
 */
export const GOAL_DASHBOARD_COLUMNS = [
  'id',
  'title',
  'description',
  'kind',
  'status',
  'size',
  'sort_order',
  'life_area_id',
  'life_area_slug',
  'life_area_name',
  'life_area_icon',
  'color',
  'start_date',
  'target_date',
  'measurement_unit',
  'start_value',
  'target_value',
  'current_value',
  'last_measured_on',
  'previous_value',
  'previous_measured_on',
  'target_count',
  'minimum_count',
  'habit_period',
  'period_start',
  'period_end',
  'period_completed_count',
  'period_minimum_met',
  'period_minimum_fraction',
  'target_sessions',
  'planned_count',
  'completed_count',
  'due_count',
  'progress_basis',
  'progress_fraction',
  'last_progress_on',
  'created_at',
  'updated_at',
].join(',');

/** The much smaller slice a calendar entry needs to render its goal without a second request. */
export const CALENDAR_GOAL_COLUMNS = [
  'id',
  'title',
  'kind',
  'color',
  'life_area_id',
  'life_area_slug',
  'life_area_name',
  'life_area_icon',
].join(',');

/**
 * The area a goal belongs to, or null when it has none.
 *
 * `life_area_id` is the only field worth testing: the view LEFT JOINs life_areas on it, so
 * either all four columns are present or all four are NULL.
 */
export function toGoalArea(row: UnknownRow): GoalArea | null {
  const id = readOptionalString(row, 'life_area_id');
  if (id === null) return null;
  return {
    id,
    slug: readString(row, 'life_area_slug'),
    name: readString(row, 'life_area_name'),
    icon: readOptionalString(row, 'life_area_icon'),
  };
}

export function toCalendarEntryGoal(row: UnknownRow): CalendarEntryGoal {
  return {
    id: readString(row, 'id'),
    title: readString(row, 'title'),
    kind: readEnum(row, 'kind', GOAL_KINDS),
    color: readString(row, 'color'),
    area: toGoalArea(row),
  };
}

/**
 * One dashboard tile.
 *
 * The kind-specific block is read with the non-optional readers on purpose: goals_kind_fields
 * guarantees those columns are NOT NULL for their kind, so a NULL means the schema and
 * src/types/database.ts have diverged, and that should surface as a 503 rather than as a tile
 * rendering `NaN`.
 */
export function toGoalSummary(row: UnknownRow): GoalSummary {
  const base = {
    id: readString(row, 'id'),
    title: readString(row, 'title'),
    description: readOptionalString(row, 'description'),
    status: readEnum(row, 'status', GOAL_STATUSES),
    size: readEnum(row, 'size', GOAL_SIZES),
    sortOrder: readInteger(row, 'sort_order'),
    area: toGoalArea(row),
    color: readString(row, 'color'),
    startDate: readOptionalDate(row, 'start_date'),
    targetDate: readOptionalDate(row, 'target_date'),
    progress: {
      basis: readEnum(row, 'progress_basis', PROGRESS_BASES),
      fraction: readOptionalNumeric(row, 'progress_fraction'),
    },
    lastProgressOn: readOptionalDate(row, 'last_progress_on'),
    createdAt: readInstant(row, 'created_at'),
    updatedAt: readInstant(row, 'updated_at'),
  };

  const kind = readEnum(row, 'kind', GOAL_KINDS);
  switch (kind) {
    case 'habit':
      return {
        ...base,
        kind,
        habit: {
          period: readEnum(row, 'habit_period', HABIT_PERIODS),
          periodStart: readDate(row, 'period_start'),
          periodEnd: readDate(row, 'period_end'),
          completedCount: readInteger(row, 'period_completed_count'),
          targetCount: readInteger(row, 'target_count'),
          minimumCount: readInteger(row, 'minimum_count'),
          minimumFraction: readNumeric(row, 'period_minimum_fraction'),
          minimumMet: readBoolean(row, 'period_minimum_met'),
        },
      };
    case 'measured':
      return {
        ...base,
        kind,
        measured: {
          unit: readOptionalString(row, 'measurement_unit'),
          startValue: readNumeric(row, 'start_value'),
          targetValue: readNumeric(row, 'target_value'),
          currentValue: readNumeric(row, 'current_value'),
          lastMeasuredOn: readOptionalDate(row, 'last_measured_on'),
          previousValue: readOptionalNumeric(row, 'previous_value'),
          previousMeasuredOn: readOptionalDate(row, 'previous_measured_on'),
        },
      };
    case 'scheduled':
      return {
        ...base,
        kind,
        scheduled: {
          targetSessions: readOptionalInteger(row, 'target_sessions'),
          plannedCount: readInteger(row, 'planned_count'),
          completedCount: readInteger(row, 'completed_count'),
          dueCount: readInteger(row, 'due_count'),
        },
      };
  }
}

/**
 * The caller's goals in the given statuses, in the order the canvas lays them out.
 *
 * `sort_order, created_at` is the schema's documented ordering: the canvas is unsorted, but the
 * layout still has to be identical across reloads.
 *
 * The default is `active` alone, which is what the dashboard has always asked for and still
 * gets. The parameter exists for "My full glasses", the shelf a finished goal moves to.
 */
export async function fetchActiveGoals(
  client: SupabaseUserClient,
  statuses: readonly GoalStatus[] = ['active'],
  timeoutMs?: number,
): Promise<GoalSummary[]> {
  const rows = await runQuery(
    (signal) => {
      const query = client.from('goal_dashboard').select(GOAL_DASHBOARD_COLUMNS);
      // `eq` for the single-status case (which is every dashboard load) rather than always `in`:
      // it is the filter goals_dashboard_idx was built for, and the default path should not pay
      // for the shelf's flexibility.
      const filtered =
        statuses.length === 1 && statuses[0] !== undefined
          ? query.eq('status', statuses[0])
          : query.in('status', [...statuses]);
      return filtered
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
        .abortSignal(signal);
    },
    '[api/goals]',
    timeoutMs,
  );

  return rows.map(toGoalSummary);
}

/**
 * One goal's tile, by id.
 *
 * Every write that changes a goal answers with this, so a client never has to refetch the whole
 * board to see a glass move. It reads the same view the dashboard does, which is the point:
 * progress is computed in SQL, so the tile a write returns and the tile the next GET returns are
 * produced by the same expression rather than by two that have to agree.
 *
 * Returns undefined when the goal is not visible to the caller — deleted, or never theirs.
 */
export async function fetchGoalSummary(
  client: SupabaseUserClient,
  goalId: string,
  timeoutMs?: number,
): Promise<GoalSummary | undefined> {
  const rows = await runQuery(
    (signal) =>
      client
        .from('goal_dashboard')
        .select(GOAL_DASHBOARD_COLUMNS)
        .eq('id', goalId)
        .abortSignal(signal),
    '[api/goals]',
    timeoutMs,
  );

  const row = rows[0];
  return row === undefined ? undefined : toGoalSummary(row);
}

/**
 * The goals referenced by a set of calendar entries, keyed by id.
 *
 * A second round-trip rather than a PostgREST embed: the effective colour only exists inside
 * goal_dashboard (it is a COALESCE over two tables), and embedding the raw goal would mean
 * re-deriving that colour in TypeScript — two copies of one rule, which is exactly how the
 * calendar and the dashboard would end up disagreeing. Bounded by the number of distinct goals
 * in the range, so it stays one indexed lookup.
 */
export async function fetchGoalsByIds(
  client: SupabaseUserClient,
  goalIds: string[],
  timeoutMs?: number,
): Promise<Map<string, CalendarEntryGoal>> {
  if (goalIds.length === 0) return new Map();

  const rows = await runQuery(
    (signal) =>
      client
        .from('goal_dashboard')
        .select(CALENDAR_GOAL_COLUMNS)
        .in('id', goalIds)
        .abortSignal(signal),
    '[api/calendar]',
    timeoutMs,
  );

  return new Map(rows.map((row) => [readString(row, 'id'), toCalendarEntryGoal(row)]));
}
