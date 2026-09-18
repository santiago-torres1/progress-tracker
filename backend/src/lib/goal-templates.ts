import { fetchLifeAreas } from './life-areas.js';
import { runQuery } from './read.js';
import {
  readEnum,
  readInteger,
  readOptionalEnum,
  readOptionalInteger,
  readOptionalNumeric,
  readOptionalString,
  readString,
  type UnknownRow,
} from './row.js';
import type { SupabaseUserClient } from './supabase.js';
import { GOAL_KINDS, HABIT_PERIODS, RECURRENCE_FREQS } from '../types/database.js';
import type { GoalTemplate, GoalTemplateGroup } from '../types/api.js';

/*
 * The goal catalogue: six suggestions per life area, from docs/goal-catalogue.md.
 *
 * Reference data, like the six areas, and read exactly the same way — no owner filter, because
 * the goal_templates_select policy is the filter and it also hides retired rows (is_active). A
 * route that remembered to add `.eq('is_active', true)` would be a second copy of that rule with
 * only one of them tested.
 *
 * NOTHING HERE TOUCHES A GOAL. There is no template id on a goal, no foreign key, and no write
 * route that accepts one: a template's numbers are copied into a form, the person edits them, and
 * POST /api/goals is sent plain fields. That is what makes every suggestion editable afterwards
 * and what makes "Something else" ordinary rather than a special case — see types/api.ts.
 */

/** `life_area_id` is selected because the response is grouped by area; no owner column exists. */
export const GOAL_TEMPLATE_COLUMNS = [
  'id',
  'life_area_id',
  'slug',
  'title',
  'kind',
  'suggested_measurement_unit',
  'suggested_start_value',
  'suggested_target_value',
  'suggested_target_count',
  'suggested_minimum_count',
  'suggested_habit_period',
  'suggested_target_sessions',
  'suggested_freq',
  'suggested_interval_count',
  'sort_order',
].join(',');

/**
 * One suggestion, discriminated on `kind` exactly as a goal is.
 *
 * The habit block is read with the non-optional readers: goal_templates_kind_fields makes both
 * counts and the period NOT NULL for a habit template, so a NULL means the table and this file
 * have diverged and should surface as a 503 rather than as a picker showing "undefined a week".
 * The measured and scheduled blocks are nullable because their suggestions genuinely are — "Reach
 * a weight" does not know which weight, and NULL says "you supply this" rather than inventing 0.
 */
export function toGoalTemplate(row: UnknownRow): GoalTemplate {
  const freq = readOptionalEnum(row, 'suggested_freq', RECURRENCE_FREQS);
  const base = {
    id: readString(row, 'id'),
    slug: readString(row, 'slug'),
    title: readString(row, 'title'),
    areaId: readString(row, 'life_area_id'),
    sortOrder: readInteger(row, 'sort_order'),
    repeat:
      freq === null
        ? null
        : { freq, interval: readOptionalInteger(row, 'suggested_interval_count') ?? 1 },
  };

  const kind = readEnum(row, 'kind', GOAL_KINDS);
  switch (kind) {
    case 'habit':
      return {
        ...base,
        kind,
        habit: {
          targetCount: readInteger(row, 'suggested_target_count'),
          minimumCount: readInteger(row, 'suggested_minimum_count'),
          period: readEnum(row, 'suggested_habit_period', HABIT_PERIODS),
        },
      };
    case 'measured':
      return {
        ...base,
        kind,
        measured: {
          unit: readOptionalString(row, 'suggested_measurement_unit'),
          startValue: readOptionalNumeric(row, 'suggested_start_value'),
          targetValue: readOptionalNumeric(row, 'suggested_target_value'),
        },
      };
    case 'scheduled':
      return {
        ...base,
        kind,
        scheduled: { targetSessions: readOptionalInteger(row, 'suggested_target_sessions') },
      };
  }
}

/**
 * The catalogue, grouped by area.
 *
 * Every area comes back, in the dashboard's own legend order, even if it has no templates left —
 * because a custom goal is offered in every area, and an area that vanished from this response
 * would take its "Something else" with it. The grouping is done here rather than with a PostgREST
 * embed so that guarantee is visible in code instead of depending on a join returning rows.
 *
 * Two round trips, in parallel: neither query needs the other's result.
 */
export async function fetchGoalTemplates(
  client: SupabaseUserClient,
  timeoutMs?: number,
): Promise<GoalTemplateGroup[]> {
  const [areas, rows] = await Promise.all([
    fetchLifeAreas(client, timeoutMs),
    runQuery(
      (signal) =>
        client
          .from('goal_templates')
          .select(GOAL_TEMPLATE_COLUMNS)
          .order('sort_order', { ascending: true })
          .order('title', { ascending: true })
          .abortSignal(signal),
      '[api/goal-templates]',
      timeoutMs,
    ),
  ]);

  const byArea = new Map<string, GoalTemplate[]>(areas.map((area) => [area.id, []]));
  for (const row of rows) {
    // A template whose area the caller cannot see is unreachable through the picker, so it is
    // left out rather than filed under a group that does not exist. The FK makes it impossible
    // today; dropping it is still better than inventing an area for it.
    byArea.get(readString(row, 'life_area_id'))?.push(toGoalTemplate(row));
  }

  return areas.map((area) => ({ area, templates: byArea.get(area.id) ?? [] }));
}
