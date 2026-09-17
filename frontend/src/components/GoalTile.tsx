import type {
  GoalProgress,
  GoalSize,
  GoalSummary,
  HabitPeriod,
  HabitState,
  MeasuredState,
  ScheduledState,
} from '../types/api';
import type { StyleWithVars } from '../types/style';
import { formatCalendarDate, formatNumber, formatPercent, toLevel } from './format';
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
}

const SIZE_CLASS: Record<GoalSize, string> = {
  small: 'goal-tile--sm',
  medium: 'goal-tile--md',
  large: 'goal-tile--lg',
};

/** How a habit's period reads in a sentence. */
const PERIOD_WINDOW: Record<HabitPeriod, string> = {
  day: 'today',
  week: 'this week',
  month: 'this month',
};

/**
 * Everything the three kinds have to agree on before the tile can draw itself.
 *
 * The switch that fills this in is exhaustive over `kind`: a fourth kind would fail to compile
 * here rather than quietly render an empty glass.
 */
interface TileDetail {
  /** Where the water sits, 0–100. */
  level: number;
  /** Where the water used to sit, when the goal has gone backwards. Null the rest of the time. */
  previousLevel: number | null;
  /** The etched line a habit stays above, 0–100. Null for the other kinds. */
  minimumLevel: number | null;
  /** The line under the title: "9 of 10 classes". */
  valueLine: string;
  /** The figure in the foot: "90%", or "1 of 4" for a habit. */
  measure: string | null;
  /** The same figure folded into the value line on a small tile, when it adds anything. */
  compactMeasure: string | null;
  /** A short, encouraging clause. Never a failure, because nothing here can produce one. */
  stateText: string | null;
  stateTick: boolean;
  /** One quiet line for a goal that slipped. No colour, no badge. */
  driftText: string | null;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled goal kind: ${JSON.stringify(value)}`);
}

function describeGoal(goal: GoalSummary): TileDetail {
  switch (goal.kind) {
    case 'scheduled':
      return describeScheduled(goal.scheduled, goal.progress);
    case 'measured':
      return describeMeasured(goal.measured, goal.progress);
    case 'habit':
      return describeHabit(goal.habit, goal.progress);
    default:
      return assertNever(goal);
  }
}

function describeScheduled(state: ScheduledState, progress: GoalProgress): TileDetail {
  const { targetSessions, completedCount, plannedCount, dueCount } = state;

  let valueLine: string;
  if (targetSessions !== null) {
    valueLine = `${completedCount} of ${targetSessions} sessions`;
  } else if (dueCount > 0) {
    valueLine = `${completedCount} of ${dueCount} so far`;
  } else {
    // Open-ended with nothing due yet: no denominator exists, so the count speaks for itself.
    valueLine = `${completedCount} done · ${plannedCount} planned`;
  }

  const measure = progress.fraction === null ? null : formatPercent(progress.fraction);

  return {
    level: progress.fraction === null ? 0 : toLevel(progress.fraction),
    previousLevel: null,
    minimumLevel: null,
    valueLine,
    measure,
    compactMeasure: measure,
    stateText: null,
    stateTick: false,
    driftText: null,
  };
}

function describeMeasured(state: MeasuredState, progress: GoalProgress): TileDetail {
  const unit = state.unit === null ? '' : ` ${state.unit}`;
  const current = formatNumber(state.currentValue);
  const target = formatNumber(state.targetValue);
  const previousLevel = previousMeasuredLevel(state, progress);
  const measure = progress.fraction === null ? null : formatPercent(progress.fraction);

  return {
    level: progress.fraction === null ? 0 : toLevel(progress.fraction),
    previousLevel,
    minimumLevel: null,
    valueLine: `${current}${unit} · target ${target}`,
    measure,
    compactMeasure: measure,
    stateText: null,
    stateTick: false,
    driftText: previousLevel === null ? null : driftLine(state.previousMeasuredOn),
  };
}

/**
 * Where the water used to be, as a level, for a measured goal that has gone backwards.
 *
 * The one figure on this tile the API does not hand it: `previousValue` is given, the fraction
 * it would have produced is not. It uses the rule the view uses for a measured goal —
 * (value - start) / (target - start) — so the hairline and the water can never disagree. Null
 * unless the goal really is lower than it was, which is the only case that draws anything.
 */
function previousMeasuredLevel(state: MeasuredState, progress: GoalProgress): number | null {
  const { startValue, targetValue, previousValue } = state;
  if (previousValue === null || progress.fraction === null) {
    return null;
  }

  const span = targetValue - startValue;
  if (span === 0) {
    return null;
  }

  const previous = toLevel((previousValue - startValue) / span);
  return previous > toLevel(progress.fraction) ? previous : null;
}

function driftLine(previousMeasuredOn: string | null): string {
  if (previousMeasuredOn === null) {
    return 'a little lower than it was last time';
  }
  const when = formatCalendarDate(previousMeasuredOn, { day: 'numeric', month: 'long' });
  return `a little lower than it was on ${when}`;
}

function describeHabit(state: HabitState, progress: GoalProgress): TileDetail {
  const { period, completedCount, targetCount, minimumCount, minimumMet } = state;
  const periodLabel = PERIOD_WINDOW[period];
  const full = completedCount >= targetCount;

  const valueLine = full
    ? `${completedCount} of ${targetCount} ${periodLabel} · full ${periodLabel}`
    : `${completedCount} of ${targetCount} ${periodLabel} · minimum is ${minimumCount}`;

  // Three encouragements and no fourth. Below the minimum is not a failure — it is a reminder
  // of how little it takes to keep the habit alive.
  let stateText: string;
  if (full) {
    stateText = `Full ${periodLabel}`;
  } else if (minimumMet) {
    stateText = `Kept alive ${periodLabel}`;
  } else if (minimumCount === 1) {
    stateText = `One is still enough ${periodLabel}`;
  } else {
    stateText = `${minimumCount} keeps it alive ${periodLabel}`;
  }

  return {
    level: progress.fraction === null ? 0 : toLevel(progress.fraction),
    previousLevel: null,
    minimumLevel: targetCount > 0 ? toLevel(minimumCount / targetCount) : null,
    valueLine,
    measure: `${completedCount} of ${targetCount}`,
    // The foot figure is already in a habit's value line; repeating it would say nothing.
    compactMeasure: null,
    stateText,
    stateTick: minimumMet,
    driftText: null,
  };
}

/**
 * A goal is a glass. The liquid is a still body of its area's colour; the surface is a 2px line
 * with a meniscus climbing both walls. Nothing else in the app uses this treatment, so "full"
 * always means the same thing.
 */
export function GoalTile({ goal, index = 0, note, onSelect }: GoalTileProps) {
  const detail = describeGoal(goal);
  const areaName = goal.area?.name ?? 'No area';
  const compact = goal.size === 'small';
  const stateText = note ?? detail.stateText;

  const valueLine =
    compact && detail.compactMeasure !== null
      ? `${detail.valueLine} · ${detail.compactMeasure}`
      : detail.valueLine;

  const style: StyleWithVars = {
    '--p': detail.level,
    '--i': index,
    ...(detail.previousLevel === null ? {} : { '--from': detail.previousLevel }),
    ...(detail.minimumLevel === null ? {} : { '--min': detail.minimumLevel }),
  };

  const className = `goal-tile ${SIZE_CLASS[goal.size]}`;
  const footFilled = detail.measure !== null || stateText !== null || detail.driftText !== null;
  const showFoot = !compact && footFilled;

  function handleClick() {
    onSelect?.(goal);
  }

  const content = (
    <>
      <span className="goal-tile__glass" aria-hidden="true">
        <span className="goal-tile__body" />
        {detail.previousLevel !== null && <span className="goal-tile__was" />}
        <span className="goal-tile__line" />
      </span>

      {detail.minimumLevel !== null && (
        <span className="goal-tile__min" aria-hidden="true">
          <span>minimum</span>
        </span>
      )}

      <span className="goal-tile__head">
        <i className="goal-tile__dot" aria-hidden="true" />
        <span className="goal-tile__area">{areaName}</span>
        <span className="goal-tile__kind">{goal.kind}</span>
      </span>

      <span className="goal-tile__name">{goal.title}</span>
      <span className="goal-tile__val">{valueLine}</span>

      {showFoot && (
        <span className="goal-tile__foot">
          {detail.measure !== null && <span className="goal-tile__pct">{detail.measure}</span>}
          {stateText !== null && (
            <span className="goal-tile__state">
              {detail.stateTick && <CheckIcon className="goal-tile__tick" />}
              {stateText}
            </span>
          )}
          {detail.driftText !== null && (
            <span className="goal-tile__drift">{detail.driftText}</span>
          )}
        </span>
      )}
    </>
  );

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
