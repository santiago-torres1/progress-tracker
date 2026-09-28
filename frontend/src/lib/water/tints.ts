/*
 * The theme's own water depths, read from the tokens.
 *
 * `--tint-top` / `-bot` / `-deep` are what the CSS water in `GoalTile.css` is built from, and they
 * differ between light and dark. The canvas cannot read a custom property while it draws, so they
 * are resolved here — once per measure — and handed to the renderer as numbers.
 *
 * This lives apart from the component that uses it so that the water bench reads them the same way
 * the board does. The canvas and the CSS drawing different liquids is not a hypothetical: it
 * shipped, and it was reported as the water looking glitchy.
 */

export type WaterTints = readonly [number, number, number];

/**
 * The three depths for one theme, as fractions, or undefined if the page has no opinion.
 *
 * Undefined is the ordinary answer in jsdom, where nothing is painted anyway — the renderer then
 * falls back to its own constants rather than drawing with `NaN`.
 */
export function readTints(styles: CSSStyleDeclaration, suffix: string): WaterTints | undefined {
  const read = (name: string): number => Number.parseFloat(styles.getPropertyValue(name)) / 100;
  const stops = [
    read(`--tint-top${suffix}`),
    read(`--tint-bot${suffix}`),
    read(`--tint-deep${suffix}`),
  ] as const;
  return stops.every((stop) => Number.isFinite(stop)) ? stops : undefined;
}

/** Both sets — resting and at the brim — for whatever theme is in force where this element is. */
export function readWaterTints(styles: CSSStyleDeclaration): {
  resting?: WaterTints;
  full?: WaterTints;
} {
  return { resting: readTints(styles, ''), full: readTints(styles, '-full') };
}
