/*
 * The component gallery: every screen surface, rendered from fixtures, with no session and no API.
 *
 * WHY IT EXISTS. The app cannot render without an anonymous account and a live backend, so the
 * only way to LOOK at a tile used to be to deploy one. Two of the bugs in 0.2.0-alpha were pure
 * layout — a pill overflowing its column, controls colliding — and neither is visible to jsdom,
 * which has no layout at all. This page is what a browser (and a screenshot) can be pointed at.
 *
 * It is dev-only: `gallery.html` sits beside `index.html` but is not in the production build's
 * inputs, so none of this reaches a visitor.
 */

import { CalendarWeek } from '../components/CalendarWeek';
import { GoalAction } from '../components/GoalAction';
import { GoalCanvas } from '../components/GoalCanvas';
import { GOALS, WEEK } from './fixtures';
import type { Arrange, ArrangeHandleProps } from '../lib/useArrange';
import type { GoalSummary } from '../types/api';
import './gallery.css';

/** Enough of `Arrange` to draw the grip. Nothing here moves — the gallery is for looking. */
function stillArrange(heldId: string | null): Arrange {
  const handleProps = (goal: GoalSummary): ArrangeHandleProps => ({
    'aria-pressed': goal.id === heldId,
    'aria-label': `Move ${goal.title}`,
    style: {},
    onKeyDown: () => undefined,
    onPointerDown: () => undefined,
    onPointerMove: () => undefined,
    onPointerUp: () => undefined,
    onPointerCancel: () => undefined,
  });

  return {
    heldId,
    message: '',
    handleProps,
    registerCell: () => () => undefined,
  };
}

interface CaseProps {
  title: string;
  note?: string;
  children: React.ReactNode;
}

function Case({ title, note, children }: CaseProps) {
  return (
    <section className="gal__case">
      <h2 className="gal__h">{title}</h2>
      {note !== undefined && <p className="gal__note">{note}</p>}
      <div className="gal__stage">{children}</div>
    </section>
  );
}

function board(heldId: string | null, undoable: ReadonlySet<string>) {
  return (
    <GoalCanvas
      goals={GOALS}
      arrange={stillArrange(heldId)}
      onSelectGoal={() => undefined}
      actionFor={(goal) => (
        <GoalAction
          goal={goal}
          busy={false}
          undoable={undoable.has(goal.id)}
          onComplete={() => undefined}
          onUndo={() => undefined}
          onLogValue={() => undefined}
        />
      )}
    />
  );
}

export function Gallery() {
  return (
    <div className="gal">
      <h1 className="gal__title">Component gallery</h1>

      <Case
        title="Board · resting"
        note="Every size, six areas, three kinds. One glass is full, one habit sits under its minimum."
      >
        {board(null, new Set())}
      </Case>

      <Case
        title="Board · a tile just ticked, and one picked up"
        note="The state the screenshots caught: Done + Undo + grip all on one tile."
      >
        {board('g-read', new Set(['g-move']))}
      </Case>

      <Case title="Calendar · week" note="Wednesday is today, and it has one entry on it.">
        <CalendarWeek
          days={WEEK}
          headline="A good pour this week."
          summary="21–27 September · two things planned, one already done."
          onSelectEntry={() => undefined}
        />
      </Case>
    </div>
  );
}
