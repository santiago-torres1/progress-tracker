/*
 * What a goal's tile says, and where its water sits.
 *
 * Moved out of `GoalTile` so anything that draws a goal — the tile, the gallery's glass study —
 * reads the same sentences from one place. Every word here is one the app already said; nothing
 * is derived that the API did not hand over, except the one level `previousMeasuredLevel` explains.
 */

import { formatCalendarDate, formatNumber, formatPercent, toLevel } from '../components/format';
import type {
  GoalProgress,
  GoalSummary,
  HabitPeriod,
  HabitState,
  MeasuredState,
  ScheduledState,
} from '../types/api';

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
export interface TileDetail {
  /** Where the water sits, 0–100. */
  level: number;
  /** Where the water used to sit, when the goal has gone backwards. Null the rest of the time. */
  previousLevel: number | null;
  /** The etched line a habit stays above, 0–100. Null for the other kinds. */
  minimumLevel: number | null;
  /** The line under the title: "9 of 10 classes". */
  valueLine: string;
  /**
   * The figure in the foot: "90%". Null for a habit, at every size — its count already opens the
   * value line, and repeating it would say nothing. Null too when there is no fraction.
   */
  measure: string | null;
  /** A short, encouraging clause. Never a failure, because nothing here can produce one. */
  stateText: string | null;
  stateTick: boolean;
  /**
   * The habit is above the line that keeps it alive. Only the etched minimum reacts to this, and
   * only by setting solid — it is a threshold that has been crossed, not a score.
   */
  keptAlive: boolean;
  /** One quiet line for a goal that slipped. No colour, no badge. */
  driftText: string | null;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled goal kind: ${JSON.stringify(value)}`);
}

export function describeGoal(goal: GoalSummary): TileDetail {
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

  return {
    level: progress.fraction === null ? 0 : toLevel(progress.fraction),
    previousLevel: null,
    minimumLevel: null,
    valueLine,
    measure: progress.fraction === null ? null : formatPercent(progress.fraction),
    stateText: null,
    stateTick: false,
    keptAlive: false,
    driftText: null,
  };
}

function describeMeasured(state: MeasuredState, progress: GoalProgress): TileDetail {
  const unit = state.unit === null ? '' : ` ${state.unit}`;
  const current = formatNumber(state.currentValue);
  const target = formatNumber(state.targetValue);
  const previousLevel = previousMeasuredLevel(state, progress);

  return {
    level: progress.fraction === null ? 0 : toLevel(progress.fraction),
    previousLevel,
    minimumLevel: null,
    valueLine: `${current}${unit} · target ${target}`,
    measure: progress.fraction === null ? null : formatPercent(progress.fraction),
    stateText: null,
    stateTick: false,
    keptAlive: false,
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
    ? `${completedCount} of ${targetCount} ${periodLabel} · target met`
    : `${completedCount} of ${targetCount} ${periodLabel} · minimum is ${minimumCount}`;

  // Three encouragements and no fourth. Below the minimum is not a failure — it is a reminder
  // of how little it takes to keep the habit alive.
  let stateText: string;
  if (full) {
    stateText = `That is the whole ${period}`;
  } else if (minimumMet) {
    stateText = `Past the minimum ${periodLabel}`;
  } else if (minimumCount === 1) {
    stateText = `One is still enough ${periodLabel}`;
  } else {
    stateText = `${minimumCount} is still enough ${periodLabel}`;
  }

  return {
    level: progress.fraction === null ? 0 : toLevel(progress.fraction),
    previousLevel: null,
    minimumLevel: targetCount > 0 ? toLevel(minimumCount / targetCount) : null,
    valueLine,
    // "1 of 3" already opens the value line; the foot repeating it would say nothing.
    measure: null,
    stateText,
    stateTick: minimumMet,
    keptAlive: minimumMet,
    driftText: null,
  };
}
