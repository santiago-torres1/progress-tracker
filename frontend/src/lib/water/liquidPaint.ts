/*
 * THE LIQUID IN A GLASS, in canvas 2D — and only the liquid.
 *
 * Promoted from the bench (`lab/sloshPaint.ts`, rounds one and two) when the owner approved the
 * water. The glass itself — its walls, rim, base and etches — is design-agent's SVG: its back layer
 * sits behind this canvas and its front layer in front. This file draws the liquid into the glass's
 * INSIDE (`LiquidVessel`, read from the `--vessel-*` tokens by `readVessel`), clipped to it, and
 * nothing else. The bench draws a glass of its own over it (`lab/benchGlass.ts`).
 *
 * CANVAS 2D ONLY. The shipped field has a Pixi path because the first liquid was thought to need
 * one; measured on the bench, this painter costs about what the shipped canvas renderer does, and a
 * hundred glasses do not need sixteen GPU contexts shared out by a pool. Shapes are still traced
 * through `PathSink`, so a GPU version would own fills and not one coordinate, if one is ever wanted.
 *
 * WHAT MAKES IT READ AS LIQUID, cheapest first:
 *
 *   - a MENISCUS, 3 CSS px, concave, where the water meets each wall — sized in pixels, not as a
 *     fraction of the glass, because surface tension does not know how big the glass is;
 *   - a visible TOP SURFACE: we look at the glass slightly from above, so the surface shows as an
 *     ellipse over the front edge — light where it is flat, liquid where it bulges (`flatFor`);
 *   - a BODY whose lightest film is just under the surface and which deepens towards the floor;
 *   - SPECULAR LIGHT on the slopes that face the room's window, keyed to the slope and CALIBRATED
 *     against this model's own slopes (see `SLOPE_ON` / `SLOPE_FULL`);
 *   - BUBBLES on a pour, a FILM left on a wall the water has run up, and what has left the body:
 *     droplets joined to it by a NECK until they snap free, beads on the walls, sheets up them.
 *
 * THE LIQUID TAKES THE GOAL'S AREA COLOUR AND NO SECOND HUE. The light is a lighter tint of that same
 * colour (mixed towards white, never towards blue), and everything else is the area colour. There is
 * no foam and no blue anywhere in this file.
 */

import { createCache, tint, type PathSink } from './path';
import type { Slosh, SurfaceFrame } from './slosh';
import { FLYING, MAX_DROPLETS } from './spray';
import type { WaterTints } from './tints';
import { traceVessel, type LiquidVessel } from './vessel';

export type { LiquidVessel } from './vessel';

export interface LiquidPaint {
  /** The area colour, resolved: `rgb(224, 180, 92)`. */
  color: string;
  /** Alpha of the area colour at the surface, mid-depth and floor. */
  stops: readonly [number, number, number];
  /**
   * A round glass (the default) rather than a box. The top surface of a cylinder seen from slightly
   * above is an ellipse: its front edge sags towards us in the middle and its band of visible
   * surface closes to nothing at the walls. The bench's tile row is a box, whose band runs across.
   */
  round?: boolean;
}

export interface LiquidRenderer {
  /** Match the backing store to the vessel and the display's pixel ratio. */
  resize(vessel: LiquidVessel, dpr: number): void;
  /** Paint the model as it is now. Call only when it moved or something else changed. */
  draw(model: Slosh, paint: LiquidPaint): void;
  /** Clear the canvas and forget its size. */
  destroy(): void;
}

/**
 * The `--liquid-*` tokens' own values, for a page with no stylesheet: alpha of the area colour at
 * the surface, mid-depth and floor, resting and at the brim. Change them with the tokens.
 */
export const LIQUID_STOPS = {
  resting: [0.3, 0.5, 0.64],
  full: [0.34, 0.54, 0.68],
} as const;

/** The stops for a glass this full: the theme's (from `readLiquidTints`) if it gave any. */
export function liquidStops(
  tints: { resting?: WaterTints; full?: WaterTints },
  full: boolean,
): WaterTints {
  return full ? (tints.full ?? LIQUID_STOPS.full) : (tints.resting ?? LIQUID_STOPS.resting);
}

/** The meniscus: how far the water climbs the wall, px, and the decay length of its curve. */
export const MENISCUS_PX = 3;
export const MENISCUS_LAMBDA = 2;
/** No meniscus below this much water, full meniscus from `MENISCUS_IN`. */
const MENISCUS_OFF = 2;
const MENISCUS_IN = 10;

/**
 * The band of top surface showing over the front edge, px, at rest.
 *
 * For a round glass it is the full height of the ellipse at the middle; for a tile, a strip. Its
 * thickness follows the slope (`TOP_TILT`): a facet tipped towards the window shows more of itself,
 * one tipped away shows less, so a rocking surface visibly opens and closes its top.
 */
export const TOP_BAND_PX = 3;
const TOP_BAND_ROUND_PX = 6;
const TOP_TILT = 0.5;

/**
 * ON A CREST THE BAND IS LIQUID, NOT LIGHT.
 *
 * Round two drew the band as a lighter tint everywhere, and on the yank-down's mound it sat on the
 * crest as a pale cap: a snow-capped hill (`r3-cap-before.png`). The band is the top surface seen
 * from slightly above, and over a crest you see the surface steeply, so it shows the liquid, not the
 * room. So where the surface bulges up, the band hands over from the light tint to the liquid's own
 * colour, and thins.
 *
 * Keyed to how much the surface BULGES UP — its curvature on a crest, never in a trough — because
 * that is what a cap is, and because the approved pour must not change: its stream digs a dimple,
 * concave, curvier than any mound, and it would lose its light if curvature in general were the
 * test. MEASURED, per-frame peak bulge in 1/px (`liquidCalibrate.test.ts`): drag ≤ 0.026, pour ≤
 * 0.064, the yank-down's mound at 110–180 ms 0.08–0.42 (median 0.08 in the 8 cm glass, 0.26 in the
 * 3.8 cm one), a flick 0.28–1.2. So the band is exactly as approved below 0.07 — every pour and
 * drag frame, to the pixel — and wholly liquid from 0.13.
 *
 * Measured over `HILL_PX` either side of each point, because the cap is the band over the whole
 * hill: at three samples only the crest's tip changed, and the window-facing flank, whose band is
 * the thickest on the surface, kept it.
 */
export const BULGE_ON = 0.07;
export const BULGE_OFF = 0.13;

/** How far either side of a crest the band goes with it, px: about half a mound's width. */
const HILL_PX = 20;

/** How thick the band is on a crest, as a share of its thickness on flat water. */
const BAND_LUMPY = 0.45;

/** The liquid part of the band: the area colour at this multiple of the surface stop, capped. */
const BAND_LIQUID = 1.8;
const BAND_LIQUID_MAX = 0.8;

/** How flat the surface is, 0–1, from how much it bulges up there. 1 below `BULGE_ON`. */
export function flatFor(bulge: number): number {
  const t = (bulge - BULGE_ON) / (BULGE_OFF - BULGE_ON);
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Where specular light starts and where it is at full strength, as a slope of the DRAWN surface
 * facing the window (top-left, as `--room-light` assumes everywhere else in the app).
 *
 * MEASURED, NOT CHOSEN. `liquidCalibrate.test.ts` runs the bench's own gestures through the model
 * and this file's own geometry; `SLOSH_REPORT=1` prints the table. The steepest facet facing the
 * window, per frame, on a tile (200×90 and 250×88) and on the bench's glass (96×150), at the
 * default strength with breakup on (round two):
 *
 *   settled              0 exactly — the model sleeps, and a sleeping surface is flat
 *   settling tail        0.003–0.006 on a tile, up to 0.016 in the glass, between "visually
 *                        still" (under 0.3 px) and asleep
 *   pour, a third        0.11–0.14 on a typical frame while it runs, 0.13–0.17 at its peak
 *                        (glass: 0.43 and 0.51)
 *   drag                 0.23–0.27 at peak on a tile (glass 0.38); 0.006–0.03 on a typical frame
 *   flick                1.4–1.5 at peak on a tile (glass 2.2); 0.3–0.4 to 1 s
 *   shake                1.6–2.1 at peak on a tile (glass 2.8)
 *   yank / lift          0.6–1.1 at peak
 *
 * So the light switches on at 0.025 — above every settling tail measured, so water that has stopped
 * moving to the eye carries none — and is full at 0.15. During a pour that lights the flank of the
 * dimple fully and 6–8% of the surface at all: a highlight that sits on the stream and travels with
 * the ring it throws off. A fling saturates the facing flank, as a shoved glass should.
 *
 * Two guesses were tried and are pinned as failing. The shipped field's 0.06 for full, on at zero,
 * lights the settling tail — still water glowing for two seconds after it stopped — and lights
 * twice as much of a pouring surface, the even band CLAUDE.md records twice. 0.02 / 0.12, the first
 * numbers this file had, were derived from a median that included the frames BEFORE the pour, and
 * saturated every frame of the pour itself.
 */
export const SLOPE_ON = 0.025;
export const SLOPE_FULL = 0.15;

/** The light itself: how thick a fully lit facet is drawn, and how strong. */
const LIGHT_PX = 2.2;
const LIGHT_ALPHA = 0.85;
/** How much of the way to white the light and the top band are mixed. Hue kept, never shifted. */
const LIGHT_MIX = 0.6;
export const BAND_MIX = 0.35;

/** The front edge: the one full-strength line, so where the water is is never in doubt. */
export const EDGE_ALPHA = 0.9;
export const EDGE_WIDTH = 1.25;

/** Absorption at the walls: two strips, deeper for a round glass, which you see the edge of. */
export const WALL_STRIP = 0.1;
export const WALL_STRIP_MAX = 22;
const WALL_ALPHA = 0.1;
export const WALL_ALPHA_ROUND = 0.2;
/** The far wall's strip, as a share of the near one's: it is seen through less glass. */
export const WALL_FAR_SHARE = 0.8;

/** The film just under the surface, as a share of the surface stop: the lightest water there is. */
export const FILM_SHARE = 0.6;

/** The band of top surface's alpha for a surface stop, capped: the room reflected in it. */
export function bandAlpha(near: number): number {
  return Math.min(0.6, near * 2.4 + 0.08);
}

/** What has left the body is a touch lighter than the band, and outlined a little finer. */
const SPRAY_MIX = 0.25;
const SPRAY_EDGE_WIDTH = 0.9;

/** Is either wall carrying a sheet? */
function sheetUp(model: Slosh): boolean {
  const a = model.sheet(0);
  const b = model.sheet(1);
  return a.tip - a.foot > 0.75 || b.tip - b.foot > 0.75;
}

/** Below this much water anywhere along the surface, nothing is drawn: an empty glass is empty. */
export const EMPTY_PX = 1;

/**
 * One frame's front edge in canvas coordinates, reused between frames.
 *
 * `px`/`py` are the smoothed run between the two menisci; the wall points and the meniscus are kept
 * apart because they are traced as one Bezier each rather than as samples, which would need a
 * sample every half-pixel to show a curve 6 px wide.
 */
export interface Edge {
  px: Float64Array;
  py: Float64Array;
  /** Band thickness at each point, px. */
  band: Float64Array;
  /** Slope of the surface towards the window at each point: positive descends to the right. */
  slope: Float64Array;
  /** Light at each point, 0–1. */
  lit: Float64Array;
  /**
   * How much the surface bulges up at each point, 1/px: the second derivative of the front edge in
   * canvas y, positive on a crest and zero (never negative) in a trough. See `flatFor`.
   */
  bulge: Float64Array;
  /** How flat the surface is around each point, 0–1: 1 shows the band as approved. See `flatFor`. */
  flat: Float64Array;
  count: number;
  /** Left and right wall x, and the surface y at each wall (without the climb). */
  leftX: number;
  rightX: number;
  leftY: number;
  rightY: number;
  /** How far the water climbs each wall, px, and how far out the climb reaches. */
  climb: number;
  reach: number;
  /** The deepest point of water, px. */
  deepest: number;
  /** The resting surface, canvas y. */
  restY: number;
}

/** Room for the most samples a surface has (97) and the two meniscus ends. */
export function createEdge(capacity = 128): Edge {
  return {
    px: new Float64Array(capacity),
    py: new Float64Array(capacity),
    band: new Float64Array(capacity),
    slope: new Float64Array(capacity),
    lit: new Float64Array(capacity),
    bulge: new Float64Array(capacity),
    flat: new Float64Array(capacity),
    count: 0,
    leftX: 0,
    rightX: 0,
    leftY: 0,
    rightY: 0,
    climb: 0,
    reach: 0,
    deepest: 0,
    restY: 0,
  };
}

/** The area one meniscus adds above the surface, px²: `5/6 · climb · λ`, from the Bezier below. */
export function meniscusArea(climb: number, lambda = MENISCUS_LAMBDA): number {
  return (5 / 6) * climb * lambda;
}

/** How much light a facet with this slope towards the window catches, 0–1. */
export function lightFor(slope: number, on = SLOPE_ON, full = SLOPE_FULL): number {
  const t = (slope - on) / (full - on);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * Turn the model's surface into canvas geometry for one frame.
 *
 * THE MENISCUS IS WATER, SO IT IS PAID FOR. The water that climbs the walls comes out of the middle:
 * the whole edge is lowered by the area of both menisci over the width, so the drawn area under the
 * edge is the level times the width and not a fraction of a pixel more. `liquidPaint.test.ts` pins
 * that, sharpened crests and all.
 */
export function buildEdge(
  frame: SurfaceFrame,
  vessel: LiquidVessel,
  round: boolean,
  edge: Edge,
): Edge {
  const { xs, hs, count, waterline: W, depth } = frame;
  const H = vessel.height;
  const inset = (vessel.width - W) / 2;

  const fade = clamp01((depth - MENISCUS_OFF) / (MENISCUS_IN - MENISCUS_OFF));
  // At the brim there is no wall left to climb.
  const room = clamp01((H - depth) / (MENISCUS_PX * 2));
  const climb = MENISCUS_PX * fade * (0.4 + 0.6 * room);
  const lambda = MENISCUS_LAMBDA;
  const reach = Math.min(3 * lambda, W / 6);
  const pay = W > 0 ? (2 * meniscusArea(climb, lambda)) / W : 0;

  const yAt = (j: number): number => H - ((hs[j] ?? 0) - pay);
  const yAtX = (x: number): number => {
    // Samples are monotonic in x: the sharpening is limited so the surface never folds.
    for (let j = 1; j < count; j += 1) {
      const right = xs[j] ?? 0;
      if (right < x) continue;
      const left = xs[j - 1] ?? 0;
      const t = right - left <= 0 ? 0 : (x - left) / (right - left);
      return yAt(j - 1) * (1 - t) + yAt(j) * t;
    }
    return yAt(count - 1);
  };

  let n = 0;
  edge.px[n] = inset + reach;
  edge.py[n] = yAtX(reach);
  n += 1;
  for (let j = 0; j < count; j += 1) {
    const x = xs[j] ?? 0;
    if (x <= reach + 0.25 || x >= W - reach - 0.25) continue;
    edge.px[n] = inset + x;
    edge.py[n] = yAt(j);
    n += 1;
  }
  edge.px[n] = inset + W - reach;
  edge.py[n] = yAtX(W - reach);
  n += 1;
  edge.count = n;

  edge.leftX = inset;
  edge.rightX = inset + W;
  edge.leftY = yAt(0);
  edge.rightY = yAt(count - 1);
  edge.climb = climb;
  edge.reach = reach;
  edge.restY = H - depth;

  let deepest = 0;
  for (let j = 0; j < count; j += 1) deepest = Math.max(deepest, (hs[j] ?? 0) - pay);
  edge.deepest = deepest;

  // How much the surface bulges, over a stencil two samples wide each way: the samples are 2 px
  // apart, and chop at that spacing is noise to a band 6 px tall.
  for (let i = 0; i < n; i += 1) {
    const a = Math.max(0, i - 2);
    const b = Math.min(n - 1, i + 2);
    const xa = edge.px[a] ?? 0;
    const xi = edge.px[i] ?? 0;
    const xb = edge.px[b] ?? 0;
    if (xb - xa <= 0 || xi - xa <= 0 || xb - xi <= 0) {
      edge.bulge[i] = 0;
      continue;
    }
    const left = ((edge.py[i] ?? 0) - (edge.py[a] ?? 0)) / (xi - xa);
    const right = ((edge.py[b] ?? 0) - (edge.py[i] ?? 0)) / (xb - xi);
    // Canvas y points down, so a crest — y smallest at i — has right minus left positive.
    edge.bulge[i] = Math.max(0, (2 * (right - left)) / (xb - xa));
  }

  // Slope towards the window, the light it catches, and how much top surface that shows.
  const bandRest = round ? TOP_BAND_ROUND_PX : TOP_BAND_PX;
  const room2 = clamp01((H - depth) / 4 + 0.35);
  for (let i = 0; i < n; i += 1) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const run = (edge.px[b] ?? 0) - (edge.px[a] ?? 0);
    // Canvas y points down: a surface descending to the right has a positive rise here, and it is
    // that facet which faces up and to the left, towards the window.
    const slope = run > 0 ? ((edge.py[b] ?? 0) - (edge.py[a] ?? 0)) / run : 0;
    edge.slope[i] = slope;
    edge.lit[i] = lightFor(slope);
    const tilt = Math.max(-1, Math.min(1, slope / SLOPE_FULL));
    // The most the surface bulges within `HILL_PX` either side: a hill's flanks go with its top.
    // Within three samples (6 px) only the very crest changed, and the cap stayed on the flank —
    // which faces the window, so its band is the thickest on the surface.
    let bulge = 0;
    for (let k = i - 1; k >= 0 && (edge.px[i] ?? 0) - (edge.px[k] ?? 0) <= HILL_PX; k -= 1) {
      bulge = Math.max(bulge, edge.bulge[k] ?? 0);
    }
    for (let k = i; k < n && (edge.px[k] ?? 0) - (edge.px[i] ?? 0) <= HILL_PX; k += 1) {
      bulge = Math.max(bulge, edge.bulge[k] ?? 0);
    }
    const flat = flatFor(bulge);
    edge.flat[i] = flat;
    let thick = bandRest * (1 + TOP_TILT * tilt) * room2 * (BAND_LUMPY + (1 - BAND_LUMPY) * flat);
    if (round) {
      const u = W > 0 ? ((edge.px[i] ?? 0) - inset) / W : 0.5;
      thick *= Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2));
    }
    edge.band[i] = Math.max(0, thick) * fade;
  }

  // A round glass: the front of the ellipse sags towards us by half its height, the back rises.
  if (round) {
    for (let i = 0; i < n; i += 1) edge.py[i] = (edge.py[i] ?? 0) + 0.5 * (edge.band[i] ?? 0);
  }

  return edge;
}

/**
 * The front edge, left wall to right wall: up the left meniscus, along the smoothed run, down the
 * right one. `lift(i)` raises each run point, which is how the back edge of the band is traced.
 */
export function traceEdge(
  sink: PathSink,
  edge: Edge,
  move: boolean,
  necks?: readonly Neck[],
  neckCount = 0,
): void {
  const { px, py, count, leftX, rightX, leftY, rightY, climb, reach } = edge;
  if (move) sink.moveTo(leftX, leftY - climb);
  else sink.lineTo(leftX, leftY - climb);
  // The meniscus as one quadratic: from the top of the climb, control `λ` out at the surface's
  // height, ending `3λ` out on the surface. That is the shape of `exp(-d / λ)` to within a tenth of
  // a pixel, and its area is exactly `5/6 · climb · λ` — see `meniscusArea`.
  sink.quadraticCurveTo(leftX + reach / 3, py[0] ?? leftY, px[0] ?? leftX, py[0] ?? leftY);
  if (necks !== undefined && neckCount > 0) traceRunNecked(sink, edge, necks, neckCount);
  else traceRun(sink, px, py, count, 0);
  sink.quadraticCurveTo(rightX - reach / 3, py[count - 1] ?? rightY, rightX, rightY - climb);
}

/** The back edge of the top band, right to left, `band[i]` above the front. */
function traceBack(
  sink: PathSink,
  edge: Edge,
  round: boolean,
  lift: (i: number) => number = (i) => edge.band[i] ?? 0,
): void {
  const { px, py, count, leftX, rightX, leftY, rightY, climb } = edge;
  // A box shows its band right to the wall; a cylinder's ellipse closes there.
  const endBand = (i: number): number => (round ? 0 : lift(i));
  sink.lineTo(rightX, rightY - climb - endBand(count - 1));
  const backY = (i: number): number => (py[i] ?? 0) - lift(i);
  sink.lineTo(px[count - 1] ?? rightX, backY(count - 1));
  for (let i = count - 2; i > 0; i -= 1) {
    const cx = px[i] ?? 0;
    const cy = backY(i);
    const nx = px[i - 1] ?? 0;
    const ny = backY(i - 1);
    sink.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
  }
  sink.lineTo(px[0] ?? leftX, backY(0));
  sink.lineTo(leftX, leftY - climb - endBand(0));
}

/** The same line as `traceBack`, left to right, `lift(i)` above the front edge. */
function traceLifted(
  sink: PathSink,
  edge: Edge,
  round: boolean,
  lift: (i: number) => number,
): void {
  const { px, py, count, leftX, rightX, leftY, rightY, climb } = edge;
  const endBand = (i: number): number => (round ? 0 : lift(i));
  const y = (i: number): number => (py[i] ?? 0) - lift(i);
  sink.moveTo(leftX, leftY - climb - endBand(0));
  sink.lineTo(px[0] ?? leftX, y(0));
  for (let i = 1; i < count - 1; i += 1) {
    const cx = px[i] ?? 0;
    const cy = y(i);
    const nx = px[i + 1] ?? 0;
    const ny = y(i + 1);
    sink.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
  }
  sink.lineTo(px[count - 1] ?? rightX, y(count - 1));
  sink.lineTo(rightX, rightY - climb - endBand(count - 1));
}

/**
 * Quadratics through the midpoints of the run, which is the same number of commands as straight
 * segments and has no facets on the crests. `dy` pushes the whole run down.
 */
function traceRun(
  sink: PathSink,
  px: Float64Array,
  py: Float64Array,
  count: number,
  dy: number,
): void {
  if (count < 2) return;
  sink.lineTo(px[0] ?? 0, (py[0] ?? 0) + dy);
  for (let i = 1; i < count - 1; i += 1) {
    const cx = px[i] ?? 0;
    const cy = (py[i] ?? 0) + dy;
    const nx = px[i + 1] ?? 0;
    const ny = (py[i + 1] ?? 0) + dy;
    sink.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
  }
  sink.lineTo(px[count - 1] ?? 0, (py[count - 1] ?? 0) + dy);
}

/*
 * PINCH-OFF ---------------------------------------------------------------------------------------
 *
 * Dots beside a smooth curve read as confetti. What reads as water coming apart is the NECK: a
 * droplet leaving is still joined to the body by a thread that narrows as it rises and snaps. So a
 * droplet within `NECK_GAP` radii of the surface is not drawn as a dot at all — the surface itself
 * detours up and over it, through a waist that thins to nothing as the gap opens, in one line and one
 * fill. Past the gap it is a free droplet, stretched along its velocity.
 */

/**
 * How far, in radii, a droplet's bottom may be from the surface and still be joined to it. A real
 * ligament stretches several diameters before it snaps; at 2.2 the neck lived ten milliseconds and
 * no frame ever caught it.
 */
export const NECK_GAP = 5;

/** Most necks drawn per glass; the rest are drawn as free droplets. */
const MAX_NECKS = 12;

export interface Neck {
  /** The droplet's centre and radius, canvas px, in the body's (heaved) frame. */
  x: number;
  cy: number;
  r: number;
  /** Half-width where the neck meets the surface, and at its waist. */
  base: number;
  waist: number;
  /** The surface's y at the two feet, and the waist's y. */
  footL: number;
  footR: number;
  waistY: number;
}

/** The front edge's y at an arbitrary x, interpolated. */
export function edgeYAt(edge: Edge, x: number): number {
  const { px, py, count } = edge;
  if (x <= (px[0] ?? 0)) return py[0] ?? 0;
  for (let i = 1; i < count; i += 1) {
    const right = px[i] ?? 0;
    if (right < x) continue;
    const left = px[i - 1] ?? 0;
    const t = right - left <= 0 ? 0 : (x - left) / (right - left);
    return (py[i - 1] ?? 0) * (1 - t) + (py[i] ?? 0) * t;
  }
  return py[count - 1] ?? 0;
}

/**
 * Choose which droplets are joined to the body this frame, and shape their necks. `joined[i]` is
 * set for every droplet that got one. Necks never overlap: where two would, the nearer one wins and
 * the other is drawn free.
 */
export function buildNecks(
  model: Slosh,
  edge: Edge,
  vessel: LiquidVessel,
  heave: number,
  out: Neck[],
  joined: Uint8Array,
): number {
  const d = model.droplets;
  joined.fill(0);
  let n = 0;
  const lo = (edge.px[0] ?? 0) + 1;
  const hi = (edge.px[edge.count - 1] ?? 0) - 1;
  for (let i = 0; i < d.count && n < MAX_NECKS; i += 1) {
    if (d.state[i] !== FLYING) continue;
    const r = d.r[i] ?? 1;
    const x = d.x[i] ?? 0;
    const cy = vessel.height - (d.y[i] ?? 0) + heave;
    const surface = edgeYAt(edge, x);
    const gap = surface - (cy + r);
    if (gap > NECK_GAP * r) continue;
    const thin = Math.max(0, Math.min(1, gap / (NECK_GAP * r)));
    const base = r * 1.3 + Math.max(0, gap) * 0.8;
    if (x - base < lo || x + base > hi) continue;
    const neck = out[n];
    if (neck === undefined) break;
    neck.x = x;
    neck.cy = cy;
    neck.r = r;
    neck.base = base;
    // The waist thins as the gap opens, and snaps at `NECK_GAP`.
    neck.waist = Math.max(0.3, r * 0.8 * (1 - thin) ** 0.7);
    neck.footL = edgeYAt(edge, x - base);
    neck.footR = edgeYAt(edge, x + base);
    neck.waistY =
      Math.min(surface, cy + r) * 0.5 + Math.max(cy + r * 0.6, surface - gap * 0.5) * 0.5;
    joined[i] = 1;
    n += 1;
  }
  // In order along the surface, and no two overlapping: the one closer to the surface stays.
  const live = out.slice(0, n).sort((a, b) => a.x - b.x);
  let kept = 0;
  for (const neck of live) {
    const previous = kept > 0 ? out[kept - 1] : undefined;
    if (previous !== undefined && neck.x - neck.base < previous.x + previous.base) {
      const gapPrev = previous.footL - previous.cy;
      const gapThis = neck.footL - neck.cy;
      if (gapThis < gapPrev) {
        unjoin(model, joined, previous);
        Object.assign(previous, neck);
      } else {
        unjoin(model, joined, neck);
      }
      continue;
    }
    const slot = out[kept];
    if (slot !== undefined) Object.assign(slot, neck);
    kept += 1;
  }
  return kept;
}

/** Forget that a droplet had a neck: it will be drawn free. */
function unjoin(model: Slosh, joined: Uint8Array, neck: Neck): void {
  const d = model.droplets;
  for (let i = 0; i < d.count; i += 1) {
    if (joined[i] === 1 && d.x[i] === neck.x) joined[i] = 0;
  }
}

/** One neck, from its left foot up, over the droplet, and down to its right foot. */
function traceNeck(sink: PathSink, neck: Neck): void {
  const { x, cy, r, base, waist, footL, footR, waistY } = neck;
  sink.quadraticCurveTo(x - waist, footL, x - waist, waistY);
  sink.quadraticCurveTo(x - waist, cy + r * 0.6, x - r, cy);
  // Over the top in two quarter circles.
  sink.quadraticCurveTo(x - r, cy - r, x, cy - r);
  sink.quadraticCurveTo(x + r, cy - r, x + r, cy);
  sink.quadraticCurveTo(x + waist, cy + r * 0.6, x + waist, waistY);
  sink.quadraticCurveTo(x + waist, footR, x + base, footR);
}

/** The run with each neck as a detour: up from the surface, over its droplet, and back. */
function traceRunNecked(sink: PathSink, edge: Edge, necks: readonly Neck[], count: number): void {
  const { px, py } = edge;
  const n = edge.count;
  sink.lineTo(px[0] ?? 0, py[0] ?? 0);
  let k = 0;
  let i = 1;
  while (i < n - 1) {
    const neck = k < count ? necks[k] : undefined;
    if (neck !== undefined && (px[i + 1] ?? 0) >= neck.x - neck.base) {
      sink.lineTo(neck.x - neck.base, neck.footL);
      traceNeck(sink, neck);
      while (i < n - 1 && (px[i] ?? 0) <= neck.x + neck.base) i += 1;
      k += 1;
      continue;
    }
    const cx = px[i] ?? 0;
    const cy = py[i] ?? 0;
    const nx = px[i + 1] ?? 0;
    const ny = py[i + 1] ?? 0;
    sink.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
    i += 1;
  }
  sink.lineTo(px[n - 1] ?? 0, py[n - 1] ?? 0);
}

/** How much a droplet is drawn stretched along its velocity, per px/s. Area is kept. */
const STRETCH = 1 / 700;
const STRETCH_MAX = 2.4;

/**
 * Everything in the air or on the walls, as one path: the necks (closed along the surface), the free
 * droplets as ellipses stretched along their velocity, the beads running down the walls, and the two
 * wall sheets. Filled once, so nothing in it is drawn twice where shapes touch.
 */
function traceSpray(
  ctx: CanvasRenderingContext2D,
  model: Slosh,
  vessel: LiquidVessel,
  heave: number,
  necks: readonly Neck[],
  neckCount: number,
  joined: Uint8Array,
): void {
  for (let k = 0; k < neckCount; k += 1) {
    const neck = necks[k];
    if (neck === undefined) continue;
    ctx.moveTo(neck.x - neck.base, neck.footL);
    traceNeck(ctx, neck);
    ctx.closePath();
  }
  const d = model.droplets;
  const H = vessel.height;
  for (let i = 0; i < d.count; i += 1) {
    if (joined[i] === 1) continue;
    const r = d.r[i] ?? 1;
    const cx = d.x[i] ?? 0;
    const cy = H - (d.y[i] ?? 0) + heave;
    let a: number;
    let b: number;
    let angle: number;
    if (d.state[i] === FLYING) {
      const vx = d.vx[i] ?? 0;
      const vy = -(d.vy[i] ?? 0);
      const stretch = Math.min(STRETCH_MAX, 1 + Math.hypot(vx, vy) * STRETCH);
      a = r * Math.sqrt(stretch);
      b = r / Math.sqrt(stretch);
      angle = Math.atan2(vy, vx);
    } else {
      // A bead on the wall, drawn out downwards as it runs.
      a = r * 1.35;
      b = r / 1.35;
      angle = Math.PI / 2;
    }
    ctx.moveTo(cx + a * Math.cos(angle), cy + a * Math.sin(angle));
    ctx.ellipse(cx, cy, a, b, angle, 0, Math.PI * 2);
  }
  for (let side = 0; side < 2; side += 1) {
    const sheet = model.sheet(side === 0 ? 0 : 1);
    const length = sheet.tip - sheet.foot;
    if (length < 0.75) continue;
    const half = ((1 - vessel.taper) * vessel.width) / 2;
    const wallAt = (y: number): number => {
      const inset = half * (1 - Math.max(0, Math.min(H, y)) / H);
      return side === 0 ? inset : vessel.width - inset;
    };
    const inward = side === 0 ? 1 : -1;
    const footY = H - sheet.foot + heave;
    const tipY = H - sheet.tip + heave;
    const midY = (footY + tipY) / 2;
    // A tongue: along the wall from its foot to its tip, and back down a slightly bellied inner edge.
    ctx.moveTo(wallAt(sheet.foot), footY + 1);
    ctx.lineTo(wallAt(sheet.tip), tipY);
    ctx.quadraticCurveTo(
      wallAt((sheet.foot + sheet.tip) / 2) + inward * sheet.thick * 0.75,
      midY,
      wallAt(sheet.foot) + inward * sheet.thick,
      footY + 1,
    );
    ctx.closePath();
  }
}

/** The body: the front edge, then down past the floor, which the vessel clips to its own shape. */
export function traceBody(sink: PathSink, edge: Edge, vessel: LiquidVessel): void {
  traceEdge(sink, edge, true);
  // Below the floor and outside the walls on purpose: the clip draws the base, so a body in flight
  // keeps the vessel's rounded corners only where the vessel has them — see `draw`.
  sink.lineTo(vessel.width + 2, edge.rightY);
  sink.lineTo(vessel.width + 2, vessel.height + 2);
  sink.lineTo(-2, vessel.height + 2);
  sink.lineTo(-2, edge.leftY);
  sink.closePath();
}

/** The body in flight: same as above, but its floor is the vessel's base, lifted with it. */
function traceBodyLifted(sink: PathSink, edge: Edge, vessel: LiquidVessel): void {
  const { width: W, height: H, taper } = vessel;
  const inset = ((1 - taper) * W) / 2;
  const r = Math.max(0, Math.min(vessel.radius, (W - 2 * inset) / 2, H));
  traceEdge(sink, edge, true);
  sink.lineTo(W - inset, H - r);
  sink.quadraticCurveTo(W - inset, H, W - inset - r, H);
  sink.lineTo(inset + r, H);
  sink.quadraticCurveTo(inset, H, inset, H - r);
  sink.closePath();
}

/** The band of visible top surface. */
/**
 * The band of top surface, in two parts. The front part — as deep as the surface is NOT flat there
 * — is the liquid seen across its own surface; the back part is the room reflected in it. Flat,
 * the back part is the whole band, exactly the band as approved. On a crest it hands over to the
 * front part, so a hill of water reads as water and not as a hill with snow on it. Returns which
 * parts have anything in them, so neither renderer pays for an empty fill.
 */
function traceBandLiquid(sink: PathSink, edge: Edge, round: boolean): boolean {
  let any = false;
  for (let i = 0; i < edge.count; i += 1) if ((edge.flat[i] ?? 1) < 0.98) any = true;
  if (!any) return false;
  traceEdge(sink, edge, true);
  traceBack(sink, edge, round, (i) => (edge.band[i] ?? 0) * (1 - (edge.flat[i] ?? 1)));
  sink.closePath();
  return true;
}

function traceBandLight(sink: PathSink, edge: Edge, round: boolean): boolean {
  let any = false;
  for (let i = 0; i < edge.count; i += 1) if ((edge.flat[i] ?? 1) > 0.02) any = true;
  if (!any) return false;
  const lower = (i: number): number => (edge.band[i] ?? 0) * (1 - (edge.flat[i] ?? 1));
  // Flat everywhere — within 2%, which the approved pour's stream never leaves — and the band is
  // traced as it was approved: from the front edge itself, meniscus and all.
  let flat = true;
  for (let i = 0; i < edge.count; i += 1) if ((edge.flat[i] ?? 1) < 0.98) flat = false;
  if (flat) traceEdge(sink, edge, true);
  else traceLifted(sink, edge, round, lower);
  traceBack(sink, edge, round);
  sink.closePath();
  return true;
}

/**
 * The band of top surface as it is on FLAT water — the whole band, the room reflected in it — for a
 * drawing of the liquid at rest (`GoalGlass`'s still water). Exactly what `draw` paints there.
 */
export function traceTopSurface(sink: PathSink, edge: Edge, round = true): void {
  traceEdge(sink, edge, true);
  traceBack(sink, edge, round);
  sink.closePath();
}

/** The specular light: a ribbon on the band, as thick as the facet is lit. False if nothing is. */
function traceLight(sink: PathSink, edge: Edge): boolean {
  const { px, py, lit, count, band } = edge;
  let any = false;
  for (let i = 0; i < count; i += 1) if ((lit[i] ?? 0) > 0.02) any = true;
  if (!any) return false;
  for (let i = 0; i < count; i += 1) {
    const w = Math.min(LIGHT_PX * (lit[i] ?? 0), Math.max(0.6, (band[i] ?? 0) + 0.8));
    if (i === 0) sink.moveTo(px[i] ?? 0, (py[i] ?? 0) - w);
    else sink.lineTo(px[i] ?? 0, (py[i] ?? 0) - w);
  }
  for (let i = count - 1; i >= 0; i -= 1) sink.lineTo(px[i] ?? 0, (py[i] ?? 0) + 0.2);
  sink.closePath();
  return true;
}

/** The area colour, mixed part of the way to white, at an alpha. Same hue; lighter, never bluer. */
export function lighten(color: string, mix: number, alpha: number): string {
  const parts = color.match(/-?\d+(\.\d+)?/g);
  if (parts === null || parts.length < 3) return color;
  const [r, g, b] = parts.map(Number);
  const up = (c: number | undefined): number => Math.round((c ?? 0) + (255 - (c ?? 0)) * mix);
  return `rgba(${up(r)}, ${up(g)}, ${up(b)}, ${alpha})`;
}

export function createLiquidRenderer(canvas: HTMLCanvasElement): LiquidRenderer | null {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;

  let vessel: LiquidVessel = { width: 0, height: 0, taper: 1, radius: 0 };
  let ratio = 0;
  let clip: Path2D | null = null;
  let edge = createEdge();
  const necks: Neck[] = Array.from({ length: 12 }, () => ({
    x: 0,
    cy: 0,
    r: 0,
    base: 0,
    waist: 0,
    footL: 0,
    footR: 0,
    waistY: 0,
  }));
  const joined = new Uint8Array(MAX_DROPLETS);

  const bodyFill = createCache<CanvasGradient>();
  const nearFill = createCache<CanvasGradient>();
  const farFill = createCache<CanvasGradient>();

  return {
    resize(next, dpr) {
      /*
       * Nothing changed, nothing done. Setting a canvas's width clears it even to the same value,
       * and a ResizeObserver reports once on observing whether or not anything moved: the glass
       * went blank for a frame right after mounting, with the still liquid already handed over.
       */
      if (
        next.width === vessel.width &&
        next.height === vessel.height &&
        next.taper === vessel.taper &&
        next.radius === vessel.radius &&
        dpr === ratio
      ) {
        return;
      }
      vessel = next;
      ratio = dpr;
      canvas.width = Math.max(1, Math.round(next.width * dpr));
      canvas.height = Math.max(1, Math.round(next.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      clip = null;
      edge = createEdge();
    },

    draw(model, paint) {
      const { width: W, height: H } = vessel;
      if (W === 0 || H === 0) return;
      ctx.clearRect(0, 0, W, H);

      if (clip === null) {
        clip = new Path2D();
        traceVessel(clip, vessel);
      }

      const frame = model.surface();
      const round = paint.round ?? true;
      buildEdge(frame, vessel, round, edge);
      const box = `${W}x${H}`;

      ctx.save();
      ctx.clip(clip);

      if (edge.deepest >= EMPTY_PX) {
        const heave = frame.heave;
        if (heave > 0) ctx.translate(0, -heave);

        // --- the body: lightest just under the surface, deepening towards the floor ------------
        const [near, middle, deep] = paint.stops;
        const rest = Math.round(edge.restY * 2) / 2;
        ctx.fillStyle = bodyFill(`${box}|${paint.color}|${rest}|${paint.stops.join()}`, () => {
          const gradient = ctx.createLinearGradient(0, rest - 2, 0, H);
          gradient.addColorStop(0, tint(paint.color, near * FILM_SHARE));
          gradient.addColorStop(0.12, tint(paint.color, near));
          gradient.addColorStop(0.7, tint(paint.color, middle));
          gradient.addColorStop(1, tint(paint.color, deep));
          return gradient;
        });
        ctx.beginPath();
        if (heave > 0) traceBodyLifted(ctx, edge, vessel);
        else traceBody(ctx, edge, vessel);
        ctx.fill();

        // --- what follows lands only on liquid already drawn ------------------------------------
        ctx.globalCompositeOperation = 'source-atop';

        // The walls: you look through more liquid at the edge of a glass than through its middle.
        const strip = Math.min(W * WALL_STRIP, WALL_STRIP_MAX);
        const wallAlpha = round ? WALL_ALPHA_ROUND : WALL_ALPHA;
        const inset = ((1 - vessel.taper) * W) / 2;
        ctx.fillStyle = nearFill(`${box}|${paint.color}|${wallAlpha}`, () =>
          edgeGradient(ctx, paint.color, inset * 0.5, inset * 0.5 + strip, wallAlpha),
        );
        ctx.fillRect(0, 0, inset * 0.5 + strip, H);
        ctx.fillStyle = farFill(`${box}|${paint.color}|${wallAlpha}`, () =>
          edgeGradient(
            ctx,
            paint.color,
            W - inset * 0.5,
            W - inset * 0.5 - strip,
            wallAlpha * WALL_FAR_SHARE,
          ),
        );
        ctx.fillRect(W - inset * 0.5 - strip, 0, inset * 0.5 + strip, H);

        // Bubbles: rings of the lighter tint, inside the liquid only.
        if (model.bubbles > 0) {
          ctx.beginPath();
          for (let i = 0; i < model.bubbles; i += 1) {
            const b = model.bubble(i);
            const x = (W - frame.waterline) / 2 + b.x;
            const y = edge.restY + b.depth;
            ctx.moveTo(x + b.r, y);
            ctx.arc(x, y, b.r, 0, Math.PI * 2);
          }
          ctx.fillStyle = lighten(paint.color, BAND_MIX, 0.3);
          ctx.fill();
          ctx.lineWidth = 0.8;
          ctx.strokeStyle = lighten(paint.color, LIGHT_MIX, 0.85);
          ctx.stroke();
        }

        ctx.globalCompositeOperation = 'source-over';

        // --- the top surface, seen from slightly above -----------------------------------------
        ctx.beginPath();
        if (traceBandLiquid(ctx, edge, round)) {
          ctx.fillStyle = tint(paint.color, Math.min(BAND_LIQUID_MAX, near * BAND_LIQUID));
          ctx.fill();
        }
        ctx.beginPath();
        if (traceBandLight(ctx, edge, round)) {
          ctx.fillStyle = lighten(paint.color, BAND_MIX, bandAlpha(near));
          ctx.fill();
        }

        // --- what has left the body: necks, droplets, beads, sheets ----------------------------
        // Nothing here runs, and nothing is allocated, unless something is in the air.
        let neckCount = 0;
        const spraying = model.droplets.count > 0 || sheetUp(model);
        if (spraying) {
          neckCount = buildNecks(model, edge, vessel, heave, necks, joined);
          ctx.beginPath();
          traceSpray(ctx, model, vessel, heave, necks, neckCount, joined);
          ctx.fillStyle = lighten(paint.color, SPRAY_MIX, Math.min(0.75, near * 3 + 0.12));
          ctx.fill();
        }

        // --- the front edge, up and over every droplet still joined to it -----------------------
        ctx.beginPath();
        traceEdge(ctx, edge, true, necks, neckCount);
        ctx.lineWidth = EDGE_WIDTH;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = tint(paint.color, EDGE_ALPHA);
        ctx.stroke();

        if (spraying) {
          // The free droplets', beads' and sheets' own outlines, and a glint on each droplet.
          ctx.beginPath();
          traceSpray(ctx, model, vessel, heave, necks, 0, joined);
          ctx.lineWidth = SPRAY_EDGE_WIDTH;
          ctx.strokeStyle = tint(paint.color, EDGE_ALPHA * 0.85);
          ctx.stroke();
          ctx.beginPath();
          const d = model.droplets;
          for (let i = 0; i < d.count; i += 1) {
            if (d.state[i] !== FLYING) continue;
            const r = d.r[i] ?? 1;
            const gx = (d.x[i] ?? 0) - r * 0.35;
            const gy = H - (d.y[i] ?? 0) + heave - r * 0.35;
            ctx.moveTo(gx + r * 0.32, gy);
            ctx.arc(gx, gy, r * 0.32, 0, Math.PI * 2);
          }
          ctx.fillStyle = lighten(paint.color, LIGHT_MIX, LIGHT_ALPHA);
          ctx.fill();
        }

        // --- specular light on the facets facing the window ------------------------------------
        ctx.beginPath();
        if (traceLight(ctx, edge)) {
          ctx.fillStyle = lighten(paint.color, LIGHT_MIX, LIGHT_ALPHA);
          ctx.fill();
        }

        if (heave > 0) ctx.translate(0, heave);

        // --- the film the water left on the walls it ran up -------------------------------------
        for (let side = 0; side < 2; side += 1) {
          const film = model.film(side === 0 ? 0 : 1);
          if (film.above <= 0 || film.strength <= 0) continue;
          const bottom = (side === 0 ? edge.leftY : edge.rightY) - edge.climb - heave;
          const top = bottom - film.above;
          const x = side === 0 ? edge.leftX : edge.rightX - 2;
          const gradient = ctx.createLinearGradient(0, top, 0, bottom);
          gradient.addColorStop(0, tint(paint.color, 0));
          gradient.addColorStop(0.35, tint(paint.color, 0.3 * film.strength));
          gradient.addColorStop(1, tint(paint.color, 0.45 * film.strength));
          ctx.fillStyle = gradient;
          ctx.fillRect(x, top, 2, bottom - top + 1);
        }
      }

      ctx.restore();
    },

    destroy() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

function edgeGradient(
  ctx: CanvasRenderingContext2D,
  color: string,
  wall: number,
  inner: number,
  alpha: number,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(wall, 0, inner, 0);
  gradient.addColorStop(0, tint(color, alpha));
  gradient.addColorStop(1, tint(color, 0));
  return gradient;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
