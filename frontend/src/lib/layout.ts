/*
 * Moving and resizing tiles, as arithmetic with no DOM in it.
 *
 * The canvas is unsorted by design and size is the owner's own statement of importance, so both
 * gestures are ordinary edits rather than anything clever: an array move, and a step along three
 * sizes. Keeping them here means the keyboard path and the pointer path do exactly the same thing
 * to the board, and the tests can check that without a browser.
 *
 * `layoutDiff` is what keeps one gesture to one request. Renumbering is deliberate — a board is
 * normalised to 10, 20, 30… as it is rearranged — and the diff then sends only the tiles that
 * actually ended up somewhere new.
 */

import type { GoalLayoutInput, GoalSize, GoalSummary } from '../types/api';

/** Small to large, in the order the resize control steps through them. */
export const SIZE_ORDER: readonly GoalSize[] = ['small', 'medium', 'large'];

/** The gap between adjacent tiles, leaving room to insert one without renumbering everything. */
const SORT_STEP = 10;

/** How a size reads in the sentence a screen reader hears. */
export const SIZE_LABEL: Readonly<Record<GoalSize, string>> = {
  small: 'small',
  medium: 'medium',
  large: 'large',
};

function renumber(goals: readonly GoalSummary[]): GoalSummary[] {
  return goals.map((goal, index) => {
    const sortOrder = (index + 1) * SORT_STEP;
    return goal.sortOrder === sortOrder ? goal : { ...goal, sortOrder };
  });
}

/**
 * The board with one tile moved to a new index.
 *
 * Out-of-range indices return the board untouched rather than throwing: "move the first tile left"
 * is a thing a person will ask for, and the honest answer is that nothing happens.
 */
export function moveTile(
  goals: readonly GoalSummary[],
  from: number,
  to: number,
): readonly GoalSummary[] {
  if (from === to) return goals;
  if (from < 0 || from >= goals.length) return goals;
  if (to < 0 || to >= goals.length) return goals;

  const next = [...goals];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return goals;

  next.splice(to, 0, moved);
  return renumber(next);
}

/** The board with one tile a step bigger or smaller. At either end, nothing happens. */
export function resizeTile(
  goals: readonly GoalSummary[],
  index: number,
  step: -1 | 1,
): readonly GoalSummary[] {
  const goal = goals[index];
  if (goal === undefined) return goals;

  const at = SIZE_ORDER.indexOf(goal.size);
  const size = SIZE_ORDER[at + step];
  if (size === undefined) return goals;

  return goals.map((item, at2) => (at2 === index ? { ...item, size } : item));
}

/**
 * What changed between two boards, as the body of one PATCH /api/goals/layout.
 *
 * Only tiles that genuinely moved or changed size are in it. A gesture that ended where it started
 * produces an empty array, and the caller sends nothing at all — the write quota is 60 a minute,
 * and a no-op drag should not spend one of them.
 */
export function layoutDiff(
  before: readonly GoalSummary[],
  after: readonly GoalSummary[],
): GoalLayoutInput[] {
  const previous = new Map(before.map((goal) => [goal.id, goal]));
  const changes: GoalLayoutInput[] = [];

  for (const goal of after) {
    const was = previous.get(goal.id);
    if (was === undefined) continue;

    const movedTo = was.sortOrder === goal.sortOrder ? undefined : goal.sortOrder;
    const resizedTo = was.size === goal.size ? undefined : goal.size;
    if (movedTo === undefined && resizedTo === undefined) continue;

    const change: GoalLayoutInput = { id: goal.id };
    if (movedTo !== undefined) change.sortOrder = movedTo;
    if (resizedTo !== undefined) change.size = resizedTo;
    changes.push(change);
  }

  return changes;
}

/** "Position 2 of 5, medium" — the whole state of a grabbed tile, in one sentence. */
export function positionMessage(
  title: string,
  index: number,
  total: number,
  size: GoalSize,
): string {
  return `${title}, position ${index + 1} of ${total}, ${SIZE_LABEL[size]}.`;
}
