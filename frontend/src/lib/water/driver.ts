/*
 * One animation loop for every glass on the board.
 *
 * A board can hold a hundred tiles. A hundred `requestAnimationFrame` loops, each measuring its
 * own element and then drawing into its own canvas, is a hundred interleaved read/write pairs —
 * and a read after a write is what forces the browser to redo layout mid-frame. So there is one
 * loop, and it runs in two phases: MEASURE EVERYTHING, then DRAW EVERYTHING. Nothing is read
 * after anything is written.
 *
 * The loop also stops. A glass that has gone still is not redrawn, and when every glass is still
 * the frame request is cancelled outright — a board nobody is touching costs nothing at all,
 * which is the difference between an idle laptop fan and a warm one.
 */

export interface Glass {
  /** The element whose horizontal movement sloshes the water — the tile itself. */
  element: HTMLElement;
  /** Called with how far the element moved since the last frame, in CSS pixels. */
  moved(dx: number): void;
  /** Advance and paint. Returns false when there is nothing left to animate. */
  render(elapsedMs: number): boolean;
}

interface Entry {
  glass: Glass;
  lastLeft: number | null;
}

const entries = new Set<Entry>();
const byGlass = new WeakMap<Glass, Entry>();

let frame: number | null = null;
let previous = 0;

function tick(now: number): void {
  const elapsed = previous === 0 ? 0 : now - previous;
  previous = now;

  // Phase 1: read. Nothing below this line has written to the DOM yet, so every
  // getBoundingClientRect answers from the same layout.
  const work: { glass: Glass; onScreen: boolean }[] = [];
  for (const entry of entries) {
    const box = entry.glass.element.getBoundingClientRect();
    if (entry.lastLeft !== null) {
      const dx = box.left - entry.lastLeft;
      if (dx !== 0) entry.glass.moved(dx);
    }
    entry.lastLeft = box.left;
    // Judged from the box we already have. A tile nobody can see needs no waves, and asking
    // for a second rectangle to find that out would cost more than the drawing does.
    const onScreen =
      box.bottom > 0 &&
      box.top < window.innerHeight &&
      box.right > 0 &&
      box.left < window.innerWidth;
    work.push({ glass: entry.glass, onScreen });
  }

  // Phase 2: write.
  let anyMoving = false;
  for (const { glass, onScreen } of work) {
    const moving = glass.render(onScreen ? elapsed : 0);
    if (moving) anyMoving = true;
  }

  if (anyMoving && entries.size > 0) {
    frame = requestAnimationFrame(tick);
  } else {
    frame = null;
    previous = 0;
  }
}

/** Start the loop if it is not already running. Safe to call on every disturbance. */
export function wake(): void {
  if (frame !== null || entries.size === 0) return;
  previous = 0;
  frame = requestAnimationFrame(tick);
}

export function join(glass: Glass): () => void {
  const entry: Entry = { glass, lastLeft: null };
  entries.add(entry);
  byGlass.set(glass, entry);
  wake();

  return () => {
    entries.delete(entry);
    byGlass.delete(glass);
    if (entries.size === 0 && frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
      previous = 0;
    }
  };
}

/** For the tests: how many glasses the loop is carrying, and whether it is running. */
export function driverState(): { glasses: number; running: boolean } {
  return { glasses: entries.size, running: frame !== null };
}
