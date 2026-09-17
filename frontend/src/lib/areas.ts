/*
 * Which life areas the key has to explain.
 *
 * Colour means area and never status, and every coloured thing also says its area in words — so
 * the key is a convenience, not the only way to read the board. It names the areas actually on
 * the canvas rather than all six, because explaining a colour nothing is wearing is noise.
 */

import type { GoalSummary, LifeArea } from '../types/api';

/** The given areas, in the API's own legend order, filtered to those a goal on the board uses. */
export function areasInUse(areas: readonly LifeArea[], goals: readonly GoalSummary[]): LifeArea[] {
  const used = new Set(
    goals.map((goal) => goal.area?.id).filter((id): id is string => id !== undefined),
  );
  return areas.filter((area) => used.has(area.id));
}
