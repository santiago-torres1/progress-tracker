/*
 * The one control on a tile.
 *
 * Which control depends on how the goal records progress, and the owner settled this: a habit or a
 * scheduled session is TICKED — "done for the day" — and a measured goal is GIVEN A NUMBER,
 * because a weight cannot be ticked. There is no third option and no combined one.
 *
 * Undo sits next to it and takes one tap. No confirmation dialog: a dialog to undo something is a
 * dialog asking "are you sure you meant to correct yourself", which is exactly the tone this app
 * does not take.
 */

import { CheckIcon } from './icons';
import type { GoalSummary } from '../types/api';

export interface GoalActionProps {
  goal: GoalSummary;
  /** A write for this goal is in flight. The control shows it; the glass waits for the answer. */
  busy: boolean;
  /** There is something to take back in one tap. */
  undoable: boolean;
  onComplete: (goal: GoalSummary) => void;
  onUndo: (goal: GoalSummary) => void;
  /** Opens the little form that logs a number. Measured goals only. */
  onLogValue: (goal: GoalSummary) => void;
}

/** "Done today", "Done this week" — a habit's tick is about its period, and says so. */
function tickLabel(goal: GoalSummary): string {
  if (goal.kind !== 'habit') return `Mark ${goal.title} done for today`;

  switch (goal.habit.period) {
    case 'day':
      return `Mark ${goal.title} done for today`;
    case 'week':
      return `Add one to ${goal.title} this week`;
    case 'month':
      return `Add one to ${goal.title} this month`;
  }
}

export function GoalAction({
  goal,
  busy,
  undoable,
  onComplete,
  onUndo,
  onLogValue,
}: GoalActionProps) {
  const undoButton = undoable ? (
    <button
      className="goal-tile__action goal-tile__undo"
      type="button"
      aria-label={`Undo the last change to ${goal.title}`}
      disabled={busy}
      onClick={() => {
        onUndo(goal);
      }}
    >
      Undo
    </button>
  ) : null;

  if (goal.kind === 'measured') {
    return (
      <>
        <button
          className="goal-tile__action goal-tile__log"
          type="button"
          aria-label={`Log a value for ${goal.title}`}
          disabled={busy}
          onClick={() => {
            onLogValue(goal);
          }}
        >
          Log a value
        </button>
        {undoButton}
      </>
    );
  }

  return (
    <>
      <button
        className="goal-tile__action goal-tile__tick"
        type="button"
        aria-label={tickLabel(goal)}
        // Optimistic, and only here: the tick goes down at once, the water waits for the number
        // the database recomputed. Guessing the fill would mean doing the view's arithmetic twice.
        aria-pressed={busy || undoable}
        aria-busy={busy}
        disabled={busy}
        onClick={() => {
          onComplete(goal);
        }}
      >
        <CheckIcon className="goal-tile__tick-mark" />
        <span className="goal-tile__action-text">Done</span>
      </button>
      {undoButton}
    </>
  );
}
