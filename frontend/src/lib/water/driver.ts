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
 *
 * WHICH MAKES KNOWING WHEN SOMEBODY *IS* TOUCHING IT LOAD-BEARING. Movement is detected by
 * measuring, and measuring only happens inside this loop, so a loop that has stopped can never
 * notice a tile being dragged — it has switched off the only sense it has. In 0.3.0-alpha nothing
 * woke it but a change of level, so the water sloshed for a second or two after a tap and then lay
 * dead flat for the rest of the session however hard anything was dragged. The pointer listeners
 * below are the fix: while a pointer is down the loop runs regardless of whether the water is
 * already moving, because that is exactly when it is about to be.
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

/**
 * A pointer is down somewhere. While it is, the loop keeps running even over still water: the
 * next frame is where the drag will show up, and a loop that stopped cannot see it arrive.
 */
let touching = false;
let listening = false;

function onPointerDown(): void {
  touching = true;
  wake();
}

function onPointerUp(): void {
  touching = false;
  // Not stopped here: whatever the drag started is still moving, and the loop winds itself down.
}

function listen(): void {
  if (listening) return;
  listening = true;
  // Capture and passive: this only ever reads that something happened, and must not be prevented
  // from hearing it by a handler further in that stops the event.
  const options = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', onPointerDown, options);
  window.addEventListener('pointerup', onPointerUp, options);
  window.addEventListener('pointercancel', onPointerUp, options);
}

function unlisten(): void {
  if (!listening) return;
  listening = false;
  touching = false;
  const options = { capture: true } as const;
  window.removeEventListener('pointerdown', onPointerDown, options);
  window.removeEventListener('pointerup', onPointerUp, options);
  window.removeEventListener('pointercancel', onPointerUp, options);
}

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

  if ((anyMoving || touching) && entries.size > 0) {
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
  listen();
  wake();

  return () => {
    entries.delete(entry);
    byGlass.delete(glass);
    if (entries.size === 0) {
      unlisten();
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
        previous = 0;
      }
    }
  };
}

/** For the tests: how many glasses the loop is carrying, and whether it is running. */
export function driverState(): { glasses: number; running: boolean; touching: boolean } {
  return { glasses: entries.size, running: frame !== null, touching };
}
