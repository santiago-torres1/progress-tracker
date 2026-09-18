/*
 * The board, as something a person can change.
 *
 * WHAT IS OPTIMISTIC AND WHAT IS NOT, and why the line is where it is.
 *
 * Optimistic: the control (a tick goes down the instant it is pressed), and the layout (a tile
 * moves where it was dropped). Neither involves a number the database computed.
 *
 * Not optimistic: the water. Every fraction on a tile comes out of `goal_dashboard`, and guessing
 * one here would mean reimplementing three kinds of progress arithmetic in TypeScript — the exact
 * thing CLAUDE.md forbids, and the exact thing that would let a glass show 40% for a moment and
 * then jump to 33%. So the tick is instant and the pour happens when the response lands, using the
 * recomputed goal the write already returned. No refetch, no arithmetic, no disagreement.
 *
 * When a write does not land, the tile goes back exactly as it was and one calm line says so.
 * Nothing here ever reads as the person's mistake, and a cap is reported as a full board.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  completeOccurrence,
  deleteGoal,
  deleteMeasurement,
  logMeasurement,
  undoCompletion,
  updateGoal,
  updateLayout,
  updateMeasurement,
  type ApiFailure,
  type ApiRequestOptions,
  type ApiResult,
} from './api';
import { failureCopy, type StatusCopy } from './copy';
import type { AuthorizedCall } from './sessionContext';
import type {
  GoalLayoutInput,
  GoalSize,
  GoalStatus,
  GoalSummary,
  UpdateGoalRequest,
} from '../types/api';

/** How long a tile stays mounted while it settles away. Matches `--mo-slow` in the stylesheet. */
export const LEAVE_MS = 320;

/**
 * What one tap of Undo would do, remembered per goal.
 *
 * Three shapes rather than one, because taking back a tick and taking back a number are genuinely
 * different operations — and because upserting a measurement onto a day that already had one
 * destroys the old value unless we put it back. `measured-restore` carries the value that was
 * there before, which is the only copy of it anywhere: the API has no route that lists check-ins.
 */
export type UndoTarget =
  | { kind: 'completion'; entryId: string }
  | { kind: 'measurement-delete'; measurementId: string }
  | { kind: 'measurement-restore'; measurementId: string; value: number; occurredOn: string };

export interface BoardNotice {
  copy: StatusCopy;
  /** The goal it concerns, so a screen can put the line next to the right tile. */
  goalId: string | null;
}

export interface GoalBoard {
  goals: readonly GoalSummary[];
  /** Ids with a write in flight: the control shows it, the glass does not move yet. */
  pending: ReadonlySet<string>;
  /** Ids on their way out, so the tile can settle away before it is unmounted. */
  leaving: ReadonlySet<string>;
  /** Ids that can be taken back in one tap, and what that would mean. */
  undoable: ReadonlyMap<string, UndoTarget>;
  notice: BoardNotice | null;
  dismissNotice: () => void;

  /** Replaces the board wholesale, from a fresh read. */
  reset: (goals: readonly GoalSummary[]) => void;
  /** Puts a newly created goal on the board without refetching it. */
  add: (goal: GoalSummary) => void;
  /** Swaps one tile for its recomputed self, in place. */
  replace: (goal: GoalSummary) => void;

  complete: (goal: GoalSummary, date?: string) => Promise<void>;
  undo: (goal: GoalSummary) => Promise<void>;
  logValue: (goal: GoalSummary, value: number, occurredOn: string) => Promise<void>;
  edit: (goal: GoalSummary, patch: UpdateGoalRequest) => Promise<boolean>;
  /** `completed` fills the glass away; `archived` files it under "My full glasses". */
  setStatus: (goal: GoalSummary, status: GoalStatus) => Promise<boolean>;
  remove: (goal: GoalSummary) => Promise<boolean>;
  /**
   * One whole gesture: every tile it moved, in one request.
   *
   * `revertTo` is the board as it was before the gesture started. It has to be passed in rather
   * than read from state here, because the board on screen has already moved — that is the point
   * of an optimistic drag — and reverting to "now" would revert to nothing.
   */
  commitLayout: (
    tiles: readonly GoalLayoutInput[],
    revertTo: readonly GoalSummary[],
  ) => Promise<boolean>;
  /** Moves tiles locally, before the gesture is committed. */
  applyLocalLayout: (next: readonly GoalSummary[]) => void;
}

function withGoal(goals: readonly GoalSummary[], next: GoalSummary): GoalSummary[] {
  return goals.map((goal) => (goal.id === next.id ? next : goal));
}

function sized(goal: GoalSummary, size: GoalSize, sortOrder: number): GoalSummary {
  return { ...goal, size, sortOrder };
}

/**
 * The board and everything that changes it.
 *
 * `call` comes from the session gate and puts the caller's token on each request; nothing in here
 * knows what a token is.
 */
export function useGoalBoard(call: AuthorizedCall): GoalBoard {
  const [goals, setGoals] = useState<readonly GoalSummary[]>([]);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [undoable, setUndoable] = useState<ReadonlyMap<string, UndoTarget>>(new Map());
  const [notice, setNotice] = useState<BoardNotice | null>(null);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );

  const markPending = useCallback((goalId: string, busy: boolean) => {
    setPending((current) => {
      const next = new Set(current);
      if (busy) next.add(goalId);
      else next.delete(goalId);
      return next;
    });
  }, []);

  const rememberUndo = useCallback((goalId: string, target: UndoTarget | null) => {
    setUndoable((current) => {
      const next = new Map(current);
      if (target === null) next.delete(goalId);
      else next.set(goalId, target);
      return next;
    });
  }, []);

  const report = useCallback((failure: ApiFailure, goalId: string | null) => {
    setNotice({ copy: failureCopy(failure), goalId });
  }, []);

  const reset = useCallback((next: readonly GoalSummary[]) => {
    setGoals(next);
  }, []);

  const add = useCallback((goal: GoalSummary) => {
    setGoals((current) => [...current, goal]);
  }, []);

  const replace = useCallback((goal: GoalSummary) => {
    setGoals((current) => withGoal(current, goal));
  }, []);

  /** Runs a write against one goal, holding the tile busy and reporting a calm line if it fails. */
  const run = useCallback(
    async <T>(
      goalId: string,
      op: (options: ApiRequestOptions) => Promise<ApiResult<T>>,
      /** Statuses the caller has already decided are fine. A 404 on an undo is "already gone". */
      tolerate: readonly ApiFailure['kind'][] = [],
    ): Promise<ApiResult<T> | null> => {
      markPending(goalId, true);
      setNotice(null);
      try {
        const result = await call(op);
        if (result.kind !== 'ok' && !tolerate.includes(result.kind)) {
          report(result, goalId);
        }
        return result;
      } finally {
        markPending(goalId, false);
      }
    },
    [call, markPending, report],
  );

  const complete = useCallback(
    async (goal: GoalSummary, date?: string) => {
      const body = date === undefined ? {} : { date };
      const result = await run(goal.id, (options) => completeOccurrence(goal.id, body, options));
      if (result?.kind !== 'ok') return;

      // The recomputed goal, straight from the write. This is the pour.
      replace(result.data.goal);
      rememberUndo(goal.id, { kind: 'completion', entryId: result.data.entry.id });
    },
    [run, replace, rememberUndo],
  );

  const undo = useCallback(
    async (goal: GoalSummary) => {
      const target = undoable.get(goal.id);
      if (target === undefined) return;

      // `missing` is tolerated everywhere below: a 404 means somebody already took it back.
      if (target.kind === 'completion') {
        const result = await run(
          goal.id,
          (options) => undoCompletion(goal.id, target.entryId, options),
          ['missing'],
        );
        if (result?.kind === 'ok') replace(result.data.goal);
        if (result?.kind === 'ok' || result?.kind === 'missing') rememberUndo(goal.id, null);
        return;
      }

      if (target.kind === 'measurement-delete') {
        const result = await run(
          goal.id,
          (options) => deleteMeasurement(goal.id, target.measurementId, options),
          ['missing'],
        );
        if (result?.kind === 'ok') replace(result.data.goal);
        if (result?.kind === 'ok' || result?.kind === 'missing') rememberUndo(goal.id, null);
        return;
      }

      // The day already held a number and logging replaced it; putting the old one back is the
      // only honest undo. Deleting would throw away a check-in the person never touched.
      const result = await run(
        goal.id,
        (options) =>
          updateMeasurement(
            goal.id,
            target.measurementId,
            { value: target.value, occurredOn: target.occurredOn },
            options,
          ),
        ['missing'],
      );
      if (result?.kind === 'ok') replace(result.data.goal);
      if (result?.kind === 'ok' || result?.kind === 'missing') rememberUndo(goal.id, null);
    },
    [undoable, run, replace, rememberUndo],
  );

  const logValue = useCallback(
    async (goal: GoalSummary, value: number, occurredOn: string) => {
      // What was on this day before, so Undo can put it back rather than delete somebody's history.
      const previous =
        goal.kind === 'measured' && goal.measured.lastMeasuredOn === occurredOn
          ? goal.measured.currentValue
          : null;

      const result = await run(goal.id, (options) =>
        logMeasurement(goal.id, { value, occurredOn }, options),
      );
      if (result?.kind !== 'ok') return;

      replace(result.data.goal);
      rememberUndo(
        goal.id,
        previous === null
          ? { kind: 'measurement-delete', measurementId: result.data.measurement.id }
          : {
              kind: 'measurement-restore',
              measurementId: result.data.measurement.id,
              value: previous,
              occurredOn,
            },
      );
    },
    [run, replace, rememberUndo],
  );

  const edit = useCallback(
    async (goal: GoalSummary, patch: UpdateGoalRequest) => {
      const result = await run(goal.id, (options) => updateGoal(goal.id, patch, options));
      if (result?.kind !== 'ok') return false;

      replace(result.data.goal);
      return true;
    },
    [run, replace],
  );

  /** Takes a tile off the board after letting it settle away with its water still in it. */
  const depart = useCallback((goalId: string) => {
    setLeaving((current) => new Set(current).add(goalId));
    const timer = setTimeout(() => {
      setGoals((current) => current.filter((goal) => goal.id !== goalId));
      setLeaving((current) => {
        const next = new Set(current);
        next.delete(goalId);
        return next;
      });
    }, LEAVE_MS);
    timers.current.push(timer);
  }, []);

  const setStatus = useCallback(
    async (goal: GoalSummary, status: GoalStatus) => {
      const result = await run(goal.id, (options) => updateGoal(goal.id, { status }, options));
      if (result?.kind !== 'ok') return false;

      // It is off the active board now, so it leaves it — gently, and with its glass as it was.
      depart(goal.id);
      return true;
    },
    [run, depart],
  );

  const remove = useCallback(
    async (goal: GoalSummary) => {
      const result = await run(goal.id, (options) => deleteGoal(goal.id, options), ['missing']);
      if (result?.kind !== 'ok' && result?.kind !== 'missing') return false;

      depart(goal.id);
      return true;
    },
    [run, depart],
  );

  const applyLocalLayout = useCallback((next: readonly GoalSummary[]) => {
    setGoals(next);
  }, []);

  /**
   * One request for one gesture.
   *
   * The board has already moved on screen by the time this runs — that is what makes dragging feel
   * like dragging. The server applies the batch all or nothing, so a refusal means putting every
   * tile back where it was, not just the one that was dragged.
   */
  const commitLayout = useCallback(
    async (tiles: readonly GoalLayoutInput[], before: readonly GoalSummary[]) => {
      if (tiles.length === 0) return true;

      setNotice(null);
      const result = await call((options) => updateLayout({ tiles: [...tiles] }, options));

      if (result.kind !== 'ok') {
        setGoals(before);
        report(result, null);
        return false;
      }

      // Take the server's own numbers rather than the ones just guessed at.
      const placed = new Map(result.data.tiles.map((tile) => [tile.id, tile]));
      setGoals((current) =>
        current.map((goal) => {
          const tile = placed.get(goal.id);
          return tile === undefined ? goal : sized(goal, tile.size, tile.sortOrder);
        }),
      );
      return true;
    },
    [call, report],
  );

  const dismissNotice = useCallback(() => {
    setNotice(null);
  }, []);

  return {
    goals,
    pending,
    leaving,
    undoable,
    notice,
    dismissNotice,
    reset,
    add,
    replace,
    complete,
    undo,
    logValue,
    edit,
    setStatus,
    remove,
    commitLayout,
    applyLocalLayout,
  };
}
