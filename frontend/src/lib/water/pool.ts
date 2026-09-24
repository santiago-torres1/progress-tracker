/*
 * Who gets the GPU.
 *
 * A browser keeps roughly sixteen WebGL contexts alive and starts dropping the oldest after that.
 * A board can hold a hundred goals. So this hands out a small, fixed number of Pixi renderers and
 * answers "no" to everyone else, and everyone else draws the identical picture in canvas 2D,
 * which has no such limit.
 *
 * The cap is deliberately well under the browser's, because this app is not the only thing on the
 * machine and a context we take is one another tab cannot have.
 *
 * The decision is made BEFORE the canvas is touched, and that ordering is not incidental: a canvas
 * element can only ever have one kind of context, so asking it for `2d` first would permanently
 * rule out WebGL for that tile.
 */

import { createPixiRenderer } from './pixiRenderer';
import type { WaterRenderer } from './renderer';

const MAX_GPU_GLASSES = 8;

let lent = 0;

/**
 * Whether the GPU path is worth trying at all. Null until the first attempt answers it.
 *
 * THIS IS LEARNED, NOT PROBED, AND THAT IS THE POINT. The obvious implementation asks a throwaway
 * canvas for a WebGL context and reports whether it got one. That version shipped for about an
 * hour and disabled the GPU path completely: taking a context to find out whether contexts are
 * available IS taking a context, and on a machine rendering WebGL in software there are very few
 * to take. Pixi then asked for one, was refused, and every tile on the board quietly fell back to
 * canvas 2D — with the fallback working perfectly, which is exactly why nobody would have noticed.
 *
 * So the first tile that wants the GPU simply tries. If that fails, no tile tries again.
 */
let gpuUsable: boolean | null = null;

export interface Lease {
  renderer: WaterRenderer;
  /** Gives the context back. Must be called, or the pool runs dry. */
  release(): void;
}

/**
 * Try to borrow a GPU renderer for this canvas.
 *
 * Null means "use canvas 2D" and is the ordinary answer for most tiles on a busy board. It is not
 * a failure and nothing is logged for it.
 */
/**
 * Acquisitions happen one at a time.
 *
 * A dozen tiles mount in the same frame and every one of them wants a context. Without a queue
 * each reserves a slot, awaits its own initialisation, and only then finds out whether it was
 * still wanted — so a wave of tiles that are about to be discarded can hold every slot while the
 * tiles that replace them find the pool full and fall back. React's StrictMode stages exactly
 * that, twice, on every mount in development.
 *
 * Serialising also caps how many GPU initialisations are in flight at once, which matters on a
 * machine where each one is expensive.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Try to borrow a GPU renderer for this canvas.
 *
 * Null means "use canvas 2D" and is the ordinary answer for most tiles on a busy board. It is not
 * a failure and nothing is logged for it. `signal` lets a tile that has gone away before its turn
 * came round take itself out of the queue rather than take a context it will immediately return.
 */
export async function borrowGpu(
  canvas: HTMLCanvasElement,
  signal?: AbortSignal,
): Promise<Lease | null> {
  const attempt = queue.then(async (): Promise<Lease | null> => {
    if (signal?.aborted === true) return null;
    if (lent >= MAX_GPU_GLASSES || gpuUsable === false) return null;

    const renderer = await createPixiRenderer(canvas);
    if (renderer === null) {
      // One refusal is enough. Either this machine cannot do WebGL or it has run out of contexts,
      // and in both cases asking again per tile is a hundred wasted initialisations.
      gpuUsable = false;
      return null;
    }

    gpuUsable = true;
    lent += 1;

    let returned = false;
    return {
      renderer,
      release() {
        if (returned) return;
        returned = true;
        lent -= 1;
        renderer.destroy();
      },
    };
  });

  // The chain must never reject, or every later acquisition inherits the rejection.
  queue = attempt.catch(() => undefined);
  return attempt;
}

/** For tests, and for anyone wondering where the contexts went. */
export function poolState(): { lent: number; cap: number; gpu: boolean | null } {
  return { lent, cap: MAX_GPU_GLASSES, gpu: gpuUsable };
}

/** Tests only: forget what was learned and what was lent. */
export function resetPool(): void {
  lent = 0;
  gpuUsable = null;
}
