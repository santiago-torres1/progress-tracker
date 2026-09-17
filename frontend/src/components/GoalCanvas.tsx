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
}

/** Placement only. How a tile looks at each size is GoalTile's business. */
const CELL_CLASS: Record<GoalSize, string> = {
  small: 'goal-canvas__cell--sm',
  medium: 'goal-canvas__cell--md',
  large: 'goal-canvas__cell--lg',
};

/**
 * The board of glasses: deliberately unsorted, with the owner's own sense of importance as the
 * only thing that changes a tile's size.
 */
export function GoalCanvas({ goals, notes, onSelectGoal }: GoalCanvasProps) {
  return (
    <ul className="goal-canvas" role="list">
      {goals.map((goal, index) => (
        <li key={goal.id} className={`goal-canvas__cell ${CELL_CLASS[goal.size]}`}>
          <GoalTile goal={goal} index={index} note={notes?.[goal.id]} onSelect={onSelectGoal} />
        </li>
      ))}
    </ul>
  );
}
