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
 *
 * BOTH AXES (round three). A glass may also ask for its ACCELERATION, x and y, which is what the
 * modal slosh (`slosh.ts`) is driven by. Three things decide how that is measured:
 *
 *   - The LAYOUT position, not the drawn one: the chain of `offsetLeft`/`offsetTop`, which no
 *     transform touches. A picked-up tile is lifted by `translateY(-2px) scale(1.015)`, hovered by
 *     `translateY(-2px)`, pressed by `scale(0.988)` — all transforms, all decoration, and none of
 *     them is the glass being moved. Measured from the client rect, the lift read as a 2 px jump
 *     upward, and every scroll of the page read as every glass being thrown vertically.
 *   - A drag on the board IS a layout change today: `useArrange` reorders the grid, so a dragged
 *     tile jumps from cell to cell. Differenced, a jump is an infinite acceleration, so the glass is
 *     CARRIED there by `Carry` (motion.ts), as a hand would carry it, and the water feels the hand.
 *   - Should a drag ever be a transform that follows the pointer, put that transform on its own
 *     element — the cell, a wrapper — and hand it in as `carrier`: its translation is added to the
 *     layout position, and the decoration stays on the tile, where it is ignored.
 */

import { Carry } from './motion';

export interface Glass {
  /** The element whose movement sloshes the water: where the liquid is drawn. */
  element: HTMLElement;
  /**
   * Advance by `elapsedMs` and paint — unless `onScreen` is false, when the water should still be
   * stepped (so it settles and sleeps) but not drawn. Returns false when nothing is left to animate.
   */
  render(elapsedMs: number, onScreen: boolean): boolean;
  /**
   * Called each frame with the glass's acceleration, CSS px/s², x to the right and y UP: the layout
   * position carried by a hand (see the note at the top).
   */
  accelerated?(ax: number, ay: number): void;
  /**
   * An element whose transform IS motion — a drag that follows the pointer by translating it — so
   * its translation counts. Decoration (lift, hover, press) must not be on it.
   */
  carrier?: HTMLElement;
}

interface Entry {
  glass: Glass;
  /** The hand carrying the glass, for a glass that asks for its acceleration. */
  carry: Carry | null;
}

/** What the last frame cost, for the bench: ms reading, ms drawing, and how many glasses. */
const last = { readMs: 0, drawMs: 0, glasses: 0, moving: 0 };

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

/** Keyboard rearranging is the real way to move a tile; a key wakes the loop so it can measure. */
function onKeyDown(): void {
  wake();
}

/** A glass scrolled back into view may have settled while it was away: one frame repaints it. */
function onScroll(): void {
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
  window.addEventListener('keydown', onKeyDown, options);
  window.addEventListener('scroll', onScroll, options);
}

function unlisten(): void {
  if (!listening) return;
  listening = false;
  touching = false;
  const options = { capture: true } as const;
  window.removeEventListener('pointerdown', onPointerDown, options);
  window.removeEventListener('pointerup', onPointerUp, options);
  window.removeEventListener('pointercancel', onPointerUp, options);
  window.removeEventListener('keydown', onKeyDown, options);
  window.removeEventListener('scroll', onScroll, options);
}

/**
 * Where an element's centre sits in the document's layout, CSS px: transforms and scrolling ignored.
 * Each offset parent's border is added, because `offsetLeft` is measured inside it — and a held
 * cell becomes `position: relative`, which makes it the tile's offset parent mid-gesture.
 */
export function layoutCentre(
  element: HTMLElement,
  carrier?: HTMLElement,
): { x: number; y: number } {
  let x = element.offsetWidth / 2;
  let y = element.offsetHeight / 2;
  // Up the chain of offset parents to the document; the chain is finite, and ends at null.
  for (let node: Element | null = element; node instanceof HTMLElement;) {
    x += node.offsetLeft;
    y += node.offsetTop;
    const parent: Element | null = node.offsetParent;
    if (parent instanceof HTMLElement) {
      x += parent.clientLeft;
      y += parent.clientTop;
    }
    node = parent;
  }
  if (carrier !== undefined) {
    const shift = translationOf(carrier);
    x += shift.x;
    y += shift.y;
  }
  return { x, y };
}

/** The translation part of an element's computed transform, px. None where it cannot be read. */
function translationOf(element: HTMLElement): { x: number; y: number } {
  const transform = getComputedStyle(element).transform;
  const Matrix = (globalThis as { DOMMatrixReadOnly?: typeof DOMMatrixReadOnly }).DOMMatrixReadOnly;
  if (transform === '' || transform === 'none' || Matrix === undefined) return { x: 0, y: 0 };
  const matrix = new Matrix(transform);
  return { x: matrix.m41, y: matrix.m42 };
}

/** The bench has the loop: nothing runs but `frameForBench`. Never set outside `lab.html`. */
let heldForBench = false;

function tick(now: number): void {
  if (heldForBench && !inBenchFrame) {
    frame = null;
    return;
  }
  const elapsed = previous === 0 ? 0 : now - previous;
  previous = now;

  // Phase 1: read. Nothing below this line has written to the DOM yet, so every
  // getBoundingClientRect answers from the same layout.
  const started = performance.now();
  const work: { glass: Glass; onScreen: boolean }[] = [];
  let carrying = false;
  for (const entry of entries) {
    const box = entry.glass.element.getBoundingClientRect();
    if (entry.carry !== null && entry.glass.accelerated !== undefined) {
      const at = layoutCentre(entry.glass.element, entry.glass.carrier);
      // y UP for the water; layout y points down.
      const { ax, ay } = entry.carry.feed(at.x, -at.y, elapsed / 1000);
      entry.glass.accelerated(ax, ay);
      if (!entry.carry.still) carrying = true;
    }

    // Judged from the drawn box, which a transform does move: what matters here is what is seen. A tile nobody can see needs no waves, and asking
    // for a second rectangle to find that out would cost more than the drawing does.
    const onScreen =
      box.bottom > 0 &&
      box.top < window.innerHeight &&
      box.right > 0 &&
      box.left < window.innerWidth;
    work.push({ glass: entry.glass, onScreen });
  }

  // Phase 2: write.
  const read = performance.now();
  let anyMoving = false;
  let moving = 0;
  for (const { glass, onScreen } of work) {
    /*
     * Real time for every glass, seen or not. A glass off screen used to be handed no time at all,
     * so one scrolled away mid-slosh never settled: it kept the loop running and was redrawn every
     * frame, unseen, for as long as the page was open. Now it steps until it sleeps, cheaply, and is
     * not painted until it is back.
     */
    if (glass.render(elapsed, onScreen)) {
      anyMoving = true;
      moving += 1;
    }
  }
  last.readMs = read - started;
  last.drawMs = performance.now() - read;
  last.glasses = work.length;
  last.moving = moving;

  // A hand still carrying a glass somewhere keeps the loop alive: it is about to slosh.
  // Held for the bench, nothing is scheduled: `frameForBench` takes the next frame itself.
  if ((anyMoving || touching || carrying) && entries.size > 0) {
    if (!heldForBench) frame = requestAnimationFrame(tick);
  } else {
    frame = null;
    previous = 0;
  }
}

/** Start the loop if it is not already running. Safe to call on every disturbance. */
export function wake(): void {
  if (heldForBench || frame !== null || entries.size === 0) return;
  previous = 0;
  frame = requestAnimationFrame(tick);
}

export function join(glass: Glass): () => void {
  const entry: Entry = {
    glass,
    carry: glass.accelerated === undefined ? null : new Carry(),
  };
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

/**
 * For the bench (`lab.html?board=1`): one frame of the loop, now, at a given timestamp, and what it
 * cost. Headless Chrome's clock does not advance inside animation frames under a virtual-time
 * budget, so the bench drives the real loop synchronously instead and times it itself.
 */
export function frameForBench(now: number): {
  readMs: number;
  drawMs: number;
  glasses: number;
  moving: number;
} {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  inBenchFrame = true;
  tick(now);
  inBenchFrame = false;
  return { ...last };
}

let inBenchFrame = false;

/**
 * For the bench: hold the loop, so that only `frameForBench` advances it and a frame can be frozen
 * for a screenshot of the real board. Released, the loop is woken as usual.
 */
export function holdForBench(held: boolean): void {
  heldForBench = held;
  if (held && frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  if (!held) wake();
}
