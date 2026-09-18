import type { ReactNode } from 'react';
import type { Arrange } from '../lib/useArrange';
import type { GoalSize, GoalSummary } from '../types/api';
import { GoalTile } from './GoalTile';
import './GoalCanvas.css';

export interface GoalCanvasProps {
  /** Rendered in the order given. The canvas is unsorted on purpose — size is the only ranking. */
  goals: readonly GoalSummary[];
  /** Per-goal copy the API cannot supply, keyed by goal id. */
  notes?: Readonly<Record<string, string>>;
  /** Omit to render the canvas as a plain, non-interactive board. */
  onSelectGoal?: (goal: GoalSummary) => void;
  /** The tile's own control: a tick for a habit, "log a value" for a measured goal. */
  actionFor?: (goal: GoalSummary) => ReactNode;
  /** Goals on their way out. The tile settles away; the caller unmounts it after 320ms. */
  leaving?: ReadonlySet<string>;
  /** Present, the board can be rearranged — by keyboard, mouse or finger. */
  arrange?: Arrange;
}

/** Placement only. How a tile looks at each size is GoalTile's business. */
const CELL_CLASS: Record<GoalSize, string> = {
  small: 'goal-canvas__cell--sm',
  medium: 'goal-canvas__cell--md',
  large: 'goal-canvas__cell--lg',
};

const ARRANGE_HINT_ID = 'goal-canvas-arrange-hint';

/**
 * The board of glasses: deliberately unsorted, with the owner's own sense of importance as the
 * only thing that changes a tile's size.
 */
export function GoalCanvas({
  goals,
  notes,
  onSelectGoal,
  actionFor,
  leaving,
  arrange,
}: GoalCanvasProps) {
  return (
    <>
      {arrange !== undefined && (
        <p className="goal-canvas__hint" id={ARRANGE_HINT_ID}>
          Pick a tile up with Space, move it with the arrow keys, resize it with + and −, and drop
          it with Space. Escape puts it back.
        </p>
      )}

      <ul className="goal-canvas" role="list">
        {goals.map((goal, index) => {
          const held = arrange?.heldId === goal.id;
          const classes = ['goal-canvas__cell', CELL_CLASS[goal.size]];
          if (held) classes.push('goal-canvas__cell--held');

          return (
            <li
              key={goal.id}
              className={classes.join(' ')}
              ref={arrange?.registerCell(goal.id)}
              aria-label={held ? `${goal.title}, being moved` : undefined}
            >
              <GoalTile
                goal={goal}
                index={index}
                note={notes?.[goal.id]}
                onSelect={onSelectGoal}
                action={
                  actionFor === undefined && arrange === undefined ? undefined : (
                    <>
                      {actionFor?.(goal)}
                      {arrange !== undefined && (
                        <button
                          className="goal-tile__action goal-tile__grip"
                          type="button"
                          aria-describedby={ARRANGE_HINT_ID}
                          {...arrange.handleProps(goal, index)}
                        >
                          <span aria-hidden="true">⠿</span>
                        </button>
                      )}
                    </>
                  )
                }
                leaving={leaving?.has(goal.id)}
              />
            </li>
          );
        })}
      </ul>

      {arrange !== undefined && (
        <p className="goal-canvas__live" role="status" aria-live="polite">
          {arrange.message}
        </p>
      )}
    </>
  );
}
