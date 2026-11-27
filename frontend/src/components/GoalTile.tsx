import type { ReactNode } from 'react';
import { describeGoal } from '../lib/describeGoal';
import type { GoalSize, GoalSummary } from '../types/api';
import type { StyleWithVars } from '../types/style';
import { GoalGlass } from './GoalGlass';
import { GoalWater } from './GoalWater';
import { CheckIcon } from './icons';
import './GoalTile.css';

export interface GoalTileProps {
  goal: GoalSummary;
  /** Position on the canvas. Used only to stagger the entrance, never to sort. */
  index?: number;
  /**
   * One line of copy the API cannot supply — "One class to go", "$150 went in today",
   * "6 weeks unbroken". Rendered in place of the derived encouragement when given; never
   * invented here.
   */
  note?: string;
  /** Omit for a plain, non-interactive tile. With it, the whole glass becomes one button. */
  onSelect?: (goal: GoalSummary) => void;
  /**
   * The tile's own control — a tick, a "+1". Supplying it turns the tile into a plain box with a
   * full-bleed target underneath, because a button cannot contain a button; `onSelect` keeps
   * working through that target. Give the element `className="goal-tile__action"` to inherit the
   * app's press feedback, and `aria-pressed` if it toggles. Omitted, the tile is exactly as it
   * was.
   */
  action?: ReactNode;
  /**
   * The tile is on its way out — deleted, or archived to "My full glasses". It fades and settles
   * away with its water still in it, over `--mo-slow` (320ms); keep it mounted that long before
   * removing it from the list. Defaults to false, which is today's behaviour.
   */
  leaving?: boolean;
}

const SIZE_CLASS: Record<GoalSize, string> = {
  small: 'goal-tile--sm',
  medium: 'goal-tile--md',
  large: 'goal-tile--lg',
};

/**
 * A goal is a glass, and the tile IS the glass: it stands on its own, and what it says hangs
 * underneath it like a label. Nothing is written on the water any more, so the water can be as deep
 * as water is and no waterline can ever run through a word.
 *
 * Size is importance, and importance is how big the glass is — small, medium or large, one shape at
 * three sizes (`--vessel-*`). The label is the same width at every size.
 *
 * The copy keeps the ORDER it always had in the document — area and kind, then the title, then the
 * value line, then the foot — because a tile that is itself a button takes its accessible name from
 * that text, and the title is lifted above the area line by CSS alone.
 */
export function GoalTile({
  goal,
  index = 0,
  note,
  onSelect,
  action,
  leaving = false,
}: GoalTileProps) {
  const detail = describeGoal(goal);
  const areaName = goal.area?.name ?? 'No area';
  const compact = goal.size === 'small';
  const stateText = note ?? detail.stateText;

  const valueLine =
    compact && detail.measure !== null
      ? `${detail.valueLine} · ${detail.measure}`
      : detail.valueLine;

  const style: StyleWithVars = { '--p': detail.level, '--i': index };

  // Every one of these is a fact about the goal right now, never a record of something that just
  // happened. A board that loads with a full glass on it shows a full glass.
  const classes = ['goal-tile', SIZE_CLASS[goal.size]];
  if (detail.level >= 100) {
    classes.push('goal-tile--full');
  }
  if (detail.keptAlive) {
    classes.push('goal-tile--kept');
  }
  if (leaving) {
    classes.push('goal-tile--leaving');
  }

  const className = classes.join(' ');
  const footFilled = detail.measure !== null || stateText !== null || detail.driftText !== null;
  const showFoot = !compact && footFilled;

  function handleClick() {
    onSelect?.(goal);
  }

  const content = (
    <>
      <span className="goal-tile__stand">
        <GoalGlass
          size={goal.size}
          level={detail.level}
          minimumLevel={detail.minimumLevel}
          previousLevel={detail.previousLevel}
          kept={detail.keptAlive}
        >
          <GoalWater level={detail.level / 100} />
        </GoalGlass>
      </span>

      <span className="goal-tile__label">
        <span className="goal-tile__head">
          <span className="goal-tile__area">
            <i className="goal-tile__dot" aria-hidden="true" />
            {areaName}
          </span>
          <span className="goal-tile__kind">{goal.kind}</span>
        </span>

        <span className="goal-tile__name">{goal.title}</span>
        <span className="goal-tile__val">{valueLine}</span>

        {showFoot && (
          <span className="goal-tile__foot">
            {detail.measure !== null && <span className="goal-tile__pct">{detail.measure}</span>}
            {stateText !== null && (
              <span className="goal-tile__state">
                {detail.stateTick && <CheckIcon className="goal-tile__kept-mark" />}
                {stateText}
              </span>
            )}
            {detail.driftText !== null && (
              <span className="goal-tile__drift">{detail.driftText}</span>
            )}
          </span>
        )}
      </span>

      {action !== undefined && <span className="goal-tile__actions">{action}</span>}
    </>
  );

  // A control inside the tile means the tile cannot itself be a button. The whole-glass target
  // becomes a transparent overlay instead, laid over the glass and the label. The controls sit above
  // that overlay (see `.goal-tile__actions`), so tapping the glass or its name still opens the goal.
  if (action !== undefined) {
    return (
      <div className={className} data-area={goal.area?.slug} style={style}>
        {content}
        {onSelect !== undefined && (
          <button
            className="goal-tile__open"
            type="button"
            aria-label={goal.title}
            onClick={handleClick}
          />
        )}
      </div>
    );
  }

  if (onSelect === undefined) {
    return (
      <div className={className} data-area={goal.area?.slug} style={style}>
        {content}
      </div>
    );
  }

  return (
    <button
      className={className}
      type="button"
      data-area={goal.area?.slug}
      style={style}
      onClick={handleClick}
    >
      {content}
    </button>
  );
}
