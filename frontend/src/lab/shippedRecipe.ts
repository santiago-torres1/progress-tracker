/*
 * The first liquid's recipe, as the particle experiment (`paint.ts`, `mesh.ts`) was built on it.
 *
 * That liquid — the spring field and its renderer, `lib/water/field.ts` and `renderer.ts` — was
 * deleted in round four, when the modal slosh went onto the board. The particle experiment is kept
 * (the owner has not approved deleting it) and it drew with that renderer's numbers so the two could
 * be compared; these are those numbers, copied unchanged, so the experiment still draws as it did.
 * Nothing on the board reads this file.
 */

import type { PathSink } from '../lib/water/path';

export { createCache, tint } from '../lib/water/path';

/** Where the body's stops sit down the liquid, surface to floor. */
export const DEPTH_OFFSETS = [0, 0.14, 0.78, 1] as const;
/** How much lighter the film just under the surface is than the water below it. */
export const NEAR_SURFACE_LIGHTEN = 0.72;
/** The surface line. */
export const SURFACE_ALPHA = 0.9;
export const SURFACE_WIDTH = 1.5;
/** The band under the surface. */
export const UNDER_DEPTH = 5;
export const UNDER_ALPHA = 0.18;
/** Absorption at the walls. */
const EDGE_WIDTH = 0.09;
const EDGE_MAX = 26;
export const EDGE_ALPHA_NEAR = 0.1;
export const EDGE_ALPHA_FAR = 0.07;
/** The glint on the waves. */
export const GLINT_ALPHA = 0.13;

/** How wide each wall strip is, in pixels. */
export function wallStripPx(width: number): number {
  return Math.min(width * EDGE_WIDTH, EDGE_MAX);
}

/** The tile-shaped vessel: square at the top, rounded at the floor. */
export function traceVessel(sink: PathSink, width: number, height: number, r: number): void {
  const radius = Math.max(0, Math.min(r, width / 2, height));
  sink.moveTo(0, 0);
  sink.lineTo(width, 0);
  sink.lineTo(width, height - radius);
  sink.quadraticCurveTo(width, height, width - radius, height);
  sink.lineTo(radius, height);
  sink.quadraticCurveTo(0, height, 0, height - radius);
  sink.closePath();
}

/** The first liquid's depths, `--tint-top` / `-bot` / `-deep` (and `-full`), for the particle row. */
export function readShippedTints(styles: CSSStyleDeclaration): {
  resting: readonly [number, number, number];
  full: readonly [number, number, number];
} {
  const read = (suffix: string, fallback: readonly [number, number, number]) => {
    const get = (name: string): number =>
      Number.parseFloat(styles.getPropertyValue(`--tint-${name}${suffix}`)) / 100;
    const stops = [get('top'), get('bot'), get('deep')] as const;
    return stops.every((stop) => Number.isFinite(stop)) ? stops : fallback;
  };
  return { resting: read('', [0.13, 0.24, 0.28]), full: read('-full', [0.18, 0.27, 0.3]) };
}
