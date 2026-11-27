/*
 * What every drawing of the water shares: the path interface its shapes are traced through, the
 * area colour at a given strength, and a cache for the gradients.
 *
 * These lived in the first renderer (`renderer.ts`, deleted in round four with the spring field it
 * drew). They outlived it because they are not about that liquid: `PathSink` is how one tracer
 * serves a canvas, an SVG path string (`GoalGlass`'s still liquid) and the tests' measurements alike.
 */

/**
 * The four path methods canvas, SVG strings and the tests agree on. Every shape in the liquid is
 * traced through this, by one piece of code: two implementations of one picture drifted once and
 * shipped a board with some glasses flat and some deep.
 */
export interface PathSink {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): unknown;
  closePath(): unknown;
}

/**
 * The area colour at a given strength, over whatever is behind it.
 *
 * `color` arrives as `rgb(r g b)` or `rgb(r, g, b)` — both spellings come back from
 * `getComputedStyle` depending on the browser — so the digits are pulled out rather than parsed
 * strictly. Anything unreadable falls back to the string as given at full strength, which is
 * visible and wrong rather than invisible and wrong.
 */
export function tint(color: string, alpha: number): string {
  const parts = color.match(/-?\d+(\.\d+)?/g);
  if (parts === null || parts.length < 3) return color;
  const [r, g, b] = parts;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * A value rebuilt only when the inputs deciding it change. Gradients are why: a board of glasses at
 * sixty frames a second is thousands of gradient objects a second for a gradient that changes when
 * the level, the size, the theme or the area colour does — almost never.
 */
export function createCache<T>(): (key: string, build: () => T) => T {
  let last: string | null = null;
  let value: T | null = null;
  return (key, build) => {
    if (value === null || key !== last) {
      value = build();
      last = key;
    }
    return value;
  };
}
