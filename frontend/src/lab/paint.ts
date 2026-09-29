/*
 * Putting the particle water on a screen, in canvas 2D.
 *
 * DELIBERATELY BUILT ON THE SHIPPED RENDERER'S NUMBERS. Every colour, alpha and depth in here is
 * imported from `lib/water/renderer.ts` rather than restated: the tint stops, the surface line's
 * strength and width, the thickness of the band under the surface, the wall absorption, the
 * brightness of the light. Two copies of one recipe drifted once already and shipped a board with
 * some glasses flat and some deep, and this bench exists to show a change of MODEL, not a change
 * of palette. If the new water looks different from the old, it is because the shape is different.
 *
 * THE LIQUID TAKES THE GOAL'S AREA COLOUR AND NO SECOND HUE. Droplets are the area colour. The film
 * on the wall is the area colour. The only thing that is not is the light, which is white, and is
 * added rather than mixed — the same two layers and the same blend mode the shipped renderer uses.
 *
 * Canvas 2D, not Pixi, for this pass. Everything is traced through `PathSink`, which is the
 * interface both renderers agree on, so a Pixi version is a second file that owns fills and blend
 * modes and not one coordinate — exactly the split `renderer.ts` insists on. Canvas first because
 * it is the path ninety-two of a hundred tiles take.
 */

import {
  DEPTH_OFFSETS,
  EDGE_ALPHA_FAR,
  EDGE_ALPHA_NEAR,
  GLINT_ALPHA,
  NEAR_SURFACE_LIGHTEN,
  SURFACE_ALPHA,
  SURFACE_WIDTH,
  UNDER_ALPHA,
  UNDER_DEPTH,
  createCache,
  tint,
  traceVessel,
  wallStripPx,
} from '../lib/water/renderer';
import type { Fluid } from './fluid';
import { Mesh } from './mesh';

export interface FluidPaint {
  /** The area colour, already resolved: `rgb(46 125 87)`. */
  color: string;
  /** Alpha at the surface, mid-depth and floor, from the theme's own tokens. */
  stops: readonly [number, number, number];
  /** Radius of the vessel's bottom corners in CSS pixels, so the liquid sits inside the glass. */
  radius: number;
}

/**
 * How steep an outline facet has to be before it counts as lit, as a slope.
 *
 * The shipped renderer's `GLINT_SLOPE` is 0.06, and the note beside it says why: it was measured
 * against that field's own peak slopes rather than guessed, and a guess was wrong by a factor of
 * ten. This model's outline is a different distribution — it has vertical facets in it, which a
 * height function cannot have — so the number is measured again here. See the calibration note:
 * settled water's outline sits almost entirely below 0.25, a pour reaches 1.4, and a fling runs off
 * the top of the scale.
 */
const LIT_SLOPE = 0.25;

/** How thick the lit facets are drawn. A line of light, not a band. */
const LIT_WIDTH = 2.2;

/**
 * The wall film: how wide a fully wetted wall is drawn, and how strongly.
 *
 * Narrow on purpose. A film is water clinging in a layer, so it reads as a darkening of the wall
 * rather than as a body of liquid — it is the same alpha the shipped renderer gives its wall
 * absorption, and the same idea.
 */
const FILM_MAX_PX = 5;
const FILM_ALPHA = 0.5;

export interface FluidRenderer {
  resize(width: number, height: number, dpr: number): void;
  draw(fluid: Fluid, paint: FluidPaint): void;
  /** Loops, outline points and milliseconds: what the bench reports about the frame. */
  readonly stats: { loops: number; points: number; ms: number };
  destroy(): void;
}

export function createFluidRenderer(canvas: HTMLCanvasElement): FluidRenderer | null {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;

  const mesh = new Mesh();
  const bodyFill = createCache<CanvasGradient>();
  const nearFill = createCache<CanvasGradient>();
  const farFill = createCache<CanvasGradient>();
  const stats = { loops: 0, points: 0, ms: 0 };

  let width = 0;
  let height = 0;
  let vessel: Path2D | null = null;

  return {
    stats,

    resize(nextWidth, nextHeight, dpr) {
      width = nextWidth;
      height = nextHeight;
      canvas.width = Math.max(1, Math.round(nextWidth * dpr));
      canvas.height = Math.max(1, Math.round(nextHeight * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      vessel = null;
    },

    draw(fluid, paint) {
      if (width === 0 || height === 0) return;
      const started = performance.now();
      ctx.clearRect(0, 0, width, height);

      if (vessel === null) {
        vessel = new Path2D();
        traceVessel(vessel, width, height, paint.radius);
      }

      mesh.build(fluid, width, height);
      stats.loops = mesh.loops;
      stats.points = mesh.points;

      ctx.save();
      ctx.clip(vessel);

      const outline = new Path2D();
      const any = mesh.trace(outline);

      if (any) {
        // --- the body -----------------------------------------------------------------------
        // Anchored to the RESTING level, like the shipped renderer, so the shading does not pump
        // up and down as waves go past. A droplet above the surface picks up the first stop, which
        // is right: it is the thinnest water in the glass.
        const rest = Math.max(0, Math.min(height, height - fluid.level * height));
        const [near, middle, deep] = paint.stops;
        ctx.fillStyle = bodyFill(
          `${width}x${height}|${paint.color}|${rest}|${paint.stops.join()}`,
          () => {
            const gradient = ctx.createLinearGradient(0, rest, 0, height);
            gradient.addColorStop(DEPTH_OFFSETS[0], tint(paint.color, near * NEAR_SURFACE_LIGHTEN));
            gradient.addColorStop(DEPTH_OFFSETS[1], tint(paint.color, near));
            gradient.addColorStop(DEPTH_OFFSETS[2], tint(paint.color, middle));
            gradient.addColorStop(DEPTH_OFFSETS[3], tint(paint.color, deep));
            return gradient;
          },
        );
        ctx.fill(outline);

        // --- the two wall strips, which are what give the liquid sides ----------------------
        const strip = wallStripPx(width);
        ctx.save();
        ctx.clip(outline);
        ctx.fillStyle = nearFill(`${width}|${paint.color}`, () =>
          edgeGradient(ctx, paint.color, 0, strip, EDGE_ALPHA_NEAR),
        );
        ctx.fillRect(0, 0, strip, height);
        ctx.fillStyle = farFill(`${width}|${paint.color}`, () =>
          edgeGradient(ctx, paint.color, width, width - strip, EDGE_ALPHA_FAR),
        );
        ctx.fillRect(width - strip, 0, strip, height);

        /*
         * --- the band under the surface -----------------------------------------------------
         * The shipped renderer draws this as a second surface curve pushed down, which only works
         * because its surface is a function. Here it is a wide stroke of the outline clipped to the
         * inside of the outline, which is the same band — one that follows the whole perimeter, so
         * a droplet gets the thickness too instead of reading as a flat disc.
         */
        ctx.lineWidth = UNDER_DEPTH * 2;
        ctx.strokeStyle = tint(paint.color, UNDER_ALPHA);
        ctx.stroke(outline);
        ctx.restore();

        // --- the surface itself -------------------------------------------------------------
        ctx.lineWidth = SURFACE_WIDTH;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = tint(paint.color, SURFACE_ALPHA);
        ctx.stroke(outline);
      }

      // --- the film left on the walls -------------------------------------------------------
      paintFilm(ctx, mesh, fluid, width, height, paint.color);

      // --- light: added to what is there, never mixed with it -------------------------------
      if (any) {
        ctx.globalCompositeOperation = 'lighter';
        const lit = new Path2D();
        if (mesh.traceLit(lit, LIT_SLOPE)) {
          ctx.lineWidth = LIT_WIDTH;
          ctx.lineCap = 'round';
          ctx.strokeStyle = `rgba(255, 255, 255, ${GLINT_ALPHA})`;
          ctx.stroke(lit);
        }
      }

      ctx.restore();
      stats.ms = performance.now() - started;
    },

    destroy() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

/**
 * The wall film, as two columns of little quads.
 *
 * Drawn only ABOVE the water at that wall, which is what `Mesh.topAt` is for: below the surface the
 * film is inside the body and drawing it there would put a dark stripe down the inside of the glass.
 */
function paintFilm(
  ctx: CanvasRenderingContext2D,
  mesh: Mesh,
  fluid: Fluid,
  width: number,
  height: number,
  color: string,
): void {
  const bins = fluid.filmLeft.length;
  const step = height / bins;

  for (const side of [0, 1] as const) {
    const film = side === 0 ? fluid.filmLeft : fluid.filmRight;
    const x = side === 0 ? 0 : width - FILM_MAX_PX;
    const surface = mesh.topAt(side === 0 ? 1 : width - 1);

    for (let k = 0; k < bins; k += 1) {
      const thickness = film[k] ?? 0;
      if (thickness < 0.02) continue;
      const bottom = height - (k / bins) * height;
      const top = bottom - step;
      // Nothing below the water: that is the body's job, and a stripe inside the liquid is a bug.
      if (bottom > surface) continue;
      ctx.fillStyle = tint(color, thickness * FILM_ALPHA);
      ctx.fillRect(x, top, FILM_MAX_PX * thickness, step + 0.5);
    }
  }
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
