/*
 * Rearranging the board, by keyboard, by mouse and by finger — through one state machine.
 *
 * THE KEYBOARD PATH IS THE REAL ONE. It is written first and it is what the tests drive: pick a
 * tile up with Space or Enter, move it with the arrow keys, make it bigger or smaller with + and
 * -, drop it with Space or Enter, and put it back with Escape. Nothing about that needs a pointer,
 * a drag image or a hover state, and it is the only version that works for somebody who cannot
 * hold a mouse still.
 *
 * The pointer path is the same machine with different events on the front. Pointer events rather
 * than mouse events, so a finger and a stylus take exactly the same code path as a mouse, and the
 * handle carries `touch-action: none` inline (a behaviour, not a style) because without it a touch
 * drag scrolls the page instead of moving the tile.
 *
 * ONE GESTURE IS ONE REQUEST. Everything between picking a tile up and putting it down — however
 * many positions it travelled through, and whether it was resized on the way — is diffed once
 * against the board as it was, and sent as a single PATCH /api/goals/layout. The write quota is
 * sixty a minute; a drag across five positions must not spend five of them.
 */

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { layoutDiff, moveTile, positionMessage, resizeTile } from './layout';
import type { GoalLayoutInput, GoalSummary } from '../types/api';

export interface ArrangeOptions {
  goals: readonly GoalSummary[];
  /** Moves the tiles on screen at once. The board is optimistic; only the numbers are not. */
  applyLocal: (goals: readonly GoalSummary[]) => void;
  /** Sends the whole gesture. `revertTo` is where the board goes if the batch is refused. */
  commit: (tiles: readonly GoalLayoutInput[], revertTo: readonly GoalSummary[]) => Promise<boolean>;
}

export interface ArrangeHandleProps {
  'aria-pressed': boolean;
  'aria-label': string;
  style: CSSProperties;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
}

export interface Arrange {
  /** The tile currently picked up, if any. */
  heldId: string | null;
  /** One sentence for the live region: where the held tile is now. */
  message: string;
  handleProps: (goal: GoalSummary, index: number) => ArrangeHandleProps;
  /** Cells register themselves so a pointer can be hit-tested against them. */
  registerCell: (id: string) => (element: HTMLElement | null) => void;
}

/** Keys that move a tile one place, in both axes, because the canvas wraps. */
const BACKWARD = new Set(['ArrowLeft', 'ArrowUp']);
const FORWARD = new Set(['ArrowRight', 'ArrowDown']);
const SMALLER = new Set(['-', '_', '[']);
const BIGGER = new Set(['+', '=', ']']);
const PICK_UP = new Set([' ', 'Enter', 'Spacebar']);

/**
 * Takes or releases the pointer, where the environment has pointer capture at all.
 *
 * jsdom does not implement it, and neither does every browser we might end up in. Capture is what
 * keeps a finger dragging a tile once it has left that tile's box, so it is worth having — but not
 * worth an exception when it is missing.
 */
function capture(element: HTMLElement, pointerId: number, take: boolean): void {
  try {
    if (take) element.setPointerCapture(pointerId);
    else element.releasePointerCapture(pointerId);
  } catch {
    // No pointer capture here. Dragging still works; it just stops at the tile's edge.
  }
}

export function useArrange({ goals, applyLocal, commit }: ArrangeOptions): Arrange {
  const [heldId, setHeldId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  /** The board as it was when the gesture started — what Escape and a refusal both go back to. */
  const startedFrom = useRef<readonly GoalSummary[] | null>(null);
  const cells = useRef(new Map<string, HTMLElement>());

  const registerCell = useCallback(
    (id: string) => (element: HTMLElement | null) => {
      if (element === null) cells.current.delete(id);
      else cells.current.set(id, element);
    },
    [],
  );

  const announce = useCallback((board: readonly GoalSummary[], id: string) => {
    const index = board.findIndex((goal) => goal.id === id);
    const goal = board[index];
    if (goal === undefined) return;
    setMessage(positionMessage(goal.title, index, board.length, goal.size));
  }, []);

  const pickUp = useCallback(
    (goal: GoalSummary, index: number) => {
      startedFrom.current = goals;
      setHeldId(goal.id);
      setMessage(
        `${positionMessage(goal.title, index, goals.length, goal.size)} ` +
          'Use the arrow keys to move it, plus and minus to resize, Enter to drop, Escape to put it back.',
      );
    },
    [goals],
  );

  const drop = useCallback(async () => {
    const before = startedFrom.current;
    startedFrom.current = null;
    setHeldId(null);
    if (before === null) return;

    const changes = layoutDiff(before, goals);
    if (changes.length === 0) {
      setMessage('Left where it was.');
      return;
    }

    setMessage('Saving the new arrangement…');
    const saved = await commit(changes, before);
    setMessage(saved ? 'Arrangement saved.' : 'Put back where it was — that did not save.');
  }, [goals, commit]);

  const cancel = useCallback(() => {
    const before = startedFrom.current;
    startedFrom.current = null;
    setHeldId(null);
    if (before !== null) applyLocal(before);
    setMessage('Put back where it was.');
  }, [applyLocal]);

  const step = useCallback(
    (goal: GoalSummary, index: number, direction: -1 | 1) => {
      const next = moveTile(goals, index, index + direction);
      if (next === goals) {
        setMessage(`${goal.title} is already at the ${direction === -1 ? 'start' : 'end'}.`);
        return;
      }
      applyLocal(next);
      announce(next, goal.id);
    },
    [goals, applyLocal, announce],
  );

  const resize = useCallback(
    (goal: GoalSummary, index: number, direction: -1 | 1) => {
      const next = resizeTile(goals, index, direction);
      if (next === goals) {
        setMessage(
          `${goal.title} is already as ${direction === -1 ? 'small' : 'large'} as it goes.`,
        );
        return;
      }
      applyLocal(next);
      announce(next, goal.id);
    },
    [goals, applyLocal, announce],
  );

  /** Which cell the pointer is over, as an index into the board. -1 when it is over none. */
  const indexUnderPointer = useCallback(
    (clientX: number, clientY: number): number => {
      for (const [id, element] of cells.current) {
        const box = element.getBoundingClientRect();
        const inside =
          clientX >= box.left &&
          clientX <= box.right &&
          clientY >= box.top &&
          clientY <= box.bottom;
        if (inside) return goals.findIndex((goal) => goal.id === id);
      }
      return -1;
    },
    [goals],
  );

  const handleProps = useCallback(
    (goal: GoalSummary, index: number): ArrangeHandleProps => {
      const held = heldId === goal.id;

      return {
        'aria-pressed': held,
        'aria-label': held ? `Moving ${goal.title}` : `Rearrange ${goal.title}`,
        // A behaviour, not an appearance: without it a touch drag scrolls the page.
        style: { touchAction: 'none' },

        onKeyDown(event) {
          if (PICK_UP.has(event.key)) {
            event.preventDefault();
            if (held) void drop();
            else pickUp(goal, index);
            return;
          }
          if (event.key === 'Escape' && held) {
            event.preventDefault();
            cancel();
            return;
          }
          if (!held) return;

          if (BACKWARD.has(event.key)) {
            event.preventDefault();
            step(goal, index, -1);
          } else if (FORWARD.has(event.key)) {
            event.preventDefault();
            step(goal, index, 1);
          } else if (SMALLER.has(event.key)) {
            event.preventDefault();
            resize(goal, index, -1);
          } else if (BIGGER.has(event.key)) {
            event.preventDefault();
            resize(goal, index, 1);
          }
        },

        onPointerDown(event) {
          if (event.button !== 0 && event.pointerType === 'mouse') return;
          capture(event.currentTarget, event.pointerId, true);
          pickUp(goal, index);
        },

        onPointerMove(event) {
          if (!held) return;
          event.preventDefault();

          const over = indexUnderPointer(event.clientX, event.clientY);
          const at = goals.findIndex((item) => item.id === goal.id);
          if (over < 0 || at < 0 || over === at) return;

          const next = moveTile(goals, at, over);
          if (next === goals) return;
          applyLocal(next);
          announce(next, goal.id);
        },

        onPointerUp(event) {
          if (!held) return;
          capture(event.currentTarget, event.pointerId, false);
          void drop();
        },

        onPointerCancel() {
          if (held) cancel();
        },
      };
    },
    [heldId, goals, pickUp, drop, cancel, step, resize, applyLocal, announce, indexUnderPointer],
  );

  return { heldId, message, handleProps, registerCell };
}
