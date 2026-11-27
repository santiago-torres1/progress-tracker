/*
 * `lab.html?board=1`: the REAL board — `GoalCanvas`, `GoalTile`, `GoalGlass`, `GoalWater` — on the
 * gallery's own goals, driven one frame at a time so it can be timed and frozen.
 *
 * Headless Chrome under a virtual-time budget does not run animation frames reliably, and does not
 * advance its clock inside them; it does through synchronous work while the page is loading. So
 * this mounts the board synchronously (`flushSync`, whose effects run before it returns), holds the
 * shared loop (`holdForBench`), and steps it itself (`frameForBench`), timing each frame: the read
 * phase (every glass's layout) and the write phase (every glass stepped, and painted if moving).
 *
 *   ?board=1                     the board at rest, then the scene
 *   &scene=pour|undo|move|all    a tick on "Move your body" (1/3 → 2/3) and its pour; that tick
 *                                undone after 1.5 s; a keyboard move (the large glass taken two
 *                                places left); every glass poured at once
 *   &frame=24                    stop after this many frames of the scene and leave them on screen
 *
 * The cost lands in `<pre id="bench-result">` as JSON. Drawing is the time to issue the canvas calls;
 * rasterising happens after, elsewhere (see `sloshBench.ts` for a flushed upper bound).
 */

import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { GoalCanvas } from '../components/GoalCanvas';
import { GOALS } from '../gallery/fixtures';
import { moveTile } from '../lib/layout';
import { frameForBench, holdForBench } from '../lib/water/driver';
import { STEP_S } from '../lib/water/slosh';
import type { GoalSummary } from '../types/api';

const FRAME_MS = STEP_S * 1000;

interface Phase {
  frames: number;
  meanMs: number;
  maxMs: number;
  readMs: number;
  drawMs: number;
  mostMoving: number;
}

export interface BoardBenchResult {
  glasses: number;
  /** The loop stops when every glass sleeps; this is what a forced frame costs anyway. */
  rest: Phase;
  scene: string;
  during: Phase;
}

function ticked(goals: readonly GoalSummary[], id: string, by: number): GoalSummary[] {
  return goals.map((goal) =>
    goal.id === id && goal.progress.fraction !== null
      ? {
          ...goal,
          progress: { ...goal.progress, fraction: Math.min(1, goal.progress.fraction + by) },
        }
      : goal,
  );
}

export function runBoardBench(host: HTMLElement, params: URLSearchParams): BoardBenchResult {
  const scene = params.get('scene') ?? 'pour';
  const stopAt = Number.parseInt(params.get('frame') ?? '', 10);
  const sceneFrames = Number.isFinite(stopAt) ? stopAt : 120;

  holdForBench(true);
  const root = createRoot(host);
  const show = (goals: readonly GoalSummary[]): void => {
    flushSync(() => {
      root.render(
        createElement('div', { className: 'lab-board' }, createElement(GoalCanvas, { goals })),
      );
    });
  };

  let goals: readonly GoalSummary[] = GOALS;
  show(goals);

  let now = 1000;
  const run = (count: number, during?: (frame: number) => void): Phase => {
    const costs: number[] = [];
    let read = 0;
    let draw = 0;
    let mostMoving = 0;
    for (let f = 0; f < count; f += 1) {
      during?.(f);
      now += FRAME_MS;
      const started = performance.now();
      const frame = frameForBench(now);
      costs.push(performance.now() - started);
      read += frame.readMs;
      draw += frame.drawMs;
      mostMoving = Math.max(mostMoving, frame.moving);
    }
    const n = Math.max(1, count);
    return {
      frames: count,
      meanMs: round(costs.reduce((sum, c) => sum + c, 0) / n),
      maxMs: round(Math.max(0, ...costs)),
      readMs: round(read / n),
      drawMs: round(draw / n),
      mostMoving,
    };
  };

  // Settle: the first frames paint every glass once, and then they sleep.
  run(30);

  const rest = run(60);

  let during: Phase;
  if (scene === 'move') {
    // A keyboard move: "Put something aside" (large, 62%) taken two places to the left, into the
    // first slot, as two presses of an arrow key do — the layout jumps; the hand carries it.
    goals = moveTile(goals, 2, 0);
    show(goals);
    during = run(sceneFrames);
  } else if (scene === 'all') {
    goals = goals.map((goal) =>
      goal.progress.fraction === null
        ? goal
        : {
            ...goal,
            progress: { ...goal.progress, fraction: Math.min(1, goal.progress.fraction + 0.3) },
          },
    );
    show(goals);
    during = run(sceneFrames);
  } else {
    goals = ticked(goals, 'g-move', 1 / 3);
    show(goals);
    during = run(sceneFrames, (f) => {
      if (scene === 'undo' && f === 90) {
        goals = ticked(goals, 'g-move', -1 / 3);
        show(goals);
      }
    });
  }

  return { glasses: GOALS.length, rest, scene, during };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
