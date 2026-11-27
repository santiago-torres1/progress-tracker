/*
 * The liquid's depths, read from the theme's tokens.
 *
 * The canvas cannot read a custom property while it draws, so `--liquid-*` is resolved here — once
 * per measure — and handed to the painter as numbers. `GoalGlass`'s still liquid reads the same
 * tokens in CSS, so the still glass and the live one are one recipe in two places, as they must be:
 * the canvas and the CSS drawing different liquids shipped once, and was reported as the water
 * looking glitchy. (`--tint-*`, the first liquid's depths, are no longer read here; `EntryBar`,
 * `CalendarMonth` and the Welcome hero still use them in CSS.)
 */

export type WaterTints = readonly [number, number, number];

/**
 * The glass's own liquid: `--liquid-top` / `-mid` / `-deep` and their `-full` versions, which
 * replaced the bench's `RICH` when tiles became glasses. Nothing reads ON this water, so it is not
 * held faint for the copy's contrast the way `--tint-*` is. Undefined where the page has no opinion
 * (jsdom); `liquidStops` in `liquidPaint.ts` falls back to the tokens' own values.
 */
export function readLiquidTints(styles: CSSStyleDeclaration): {
  resting?: WaterTints;
  full?: WaterTints;
} {
  const read = (suffix: string): WaterTints | undefined => {
    const get = (name: string): number =>
      Number.parseFloat(styles.getPropertyValue(`--liquid-${name}${suffix}`)) / 100;
    const stops = [get('top'), get('mid'), get('deep')] as const;
    return stops.every((stop) => Number.isFinite(stop)) ? stops : undefined;
  };
  return { resting: read(''), full: read('-full') };
}
