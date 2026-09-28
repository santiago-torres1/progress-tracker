/*
 * The same liquid, drawn on the GPU.
 *
 * WHAT PIXI BUYS HERE, AND WHAT IT COSTS. The shape is a filled polygon with a stroked top edge,
 * redrawn every frame. On the GPU that is free; in canvas 2D it is nearly free. The real
 * difference is the ceiling: WebGL can carry gradients, displacement and light through the liquid
 * later without the per-pixel work landing on the main thread, which is why this exists.
 *
 * THE COST IS CONTEXTS. One Pixi `Application` owns one WebGL context, and a browser will keep
 * only about sixteen alive at once — after that it starts dropping the oldest, and a dropped
 * context is a tile whose water vanishes. A board can hold a hundred tiles. So Pixi is NOT handed
 * out per tile: `pool.ts` lends a fixed, small number of renderers to the tiles that most deserve
 * one, and everything else draws in canvas 2D, which has no such limit and produces the same
 * picture.
 *
 * Both renderers implement `WaterRenderer` and are tested against the same expectations, so which
 * one a given glass got is not something a reader can see.
 */

import {
  SHEEN_ALPHA,
  SHEEN_OFFSET,
  SHEEN_WIDTH,
  SURFACE_ALPHA,
  SURFACE_POINTS,
  SURFACE_WIDTH,
  depthStops,
  surfacePoints,
  tint,
  type WaterPaint,
  type WaterRenderer,
} from './renderer';

/**
 * Why the last GPU attempt failed, if one did.
 *
 * Falling back to canvas 2D is an ordinary outcome and is never logged — a busy board does it by
 * design. But "it silently fell back for every tile on a machine with working WebGL" is a bug, and
 * without this there is nothing to look at.
 */
let lastFailure: string | null = null;

export function lastGpuFailure(): string | null {
  return lastFailure;
}

/** Pixi wants numbers, CSS gives strings. */
function toHex(color: string): number {
  const parts = color.match(/-?\d+(\.\d+)?/g);
  if (parts === null || parts.length < 3) return 0x64748b;
  const [r, g, b] = parts;
  return ((Number(r) & 255) << 16) | ((Number(g) & 255) << 8) | (Number(b) & 255);
}

/**
 * Bring a Pixi renderer up on an existing canvas.
 *
 * Async, because `Application.init` is — it has a GPU adapter to ask for. Resolves to null when
 * WebGL is unavailable or the context could not be created, which is an ordinary answer and not
 * an error: the caller falls back to canvas 2D.
 */
export async function createPixiRenderer(canvas: HTMLCanvasElement): Promise<WaterRenderer | null> {
  /*
   * Loaded here, not at the top of the file.
   *
   * Pixi is the largest thing in this application by a wide margin, and it decorates: a board is
   * completely usable with the liquid drawn in canvas 2D, and a reader who asked for less motion
   * never draws it at all. A static import puts all of it in the entry chunk, where it blocks the
   * first paint of a page that has not yet decided whether it wants a GPU. This way it is fetched
   * once, in parallel, by whichever tile asks first — and never at all by the people who do not.
   */
  let Application: typeof import('pixi.js').Application;
  let Graphics: typeof import('pixi.js').Graphics;
  let FillGradient: typeof import('pixi.js').FillGradient;
  try {
    ({ Application, Graphics, FillGradient } = await import('pixi.js'));
  } catch (error) {
    lastFailure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return null;
  }

  const app = new Application();

  try {
    await app.init({
      canvas,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      // We drive the frames ourselves, from the one loop in `driver.ts`. Pixi's own ticker would
      // be a second clock running against the first.
      autoStart: false,
      preference: 'webgl',
    });
  } catch (error) {
    lastFailure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return null;
  }

  const body = new Graphics();
  const surface = new Graphics();
  const sheen = new Graphics();
  app.stage.addChild(body, surface, sheen);

  let width = 0;
  let height = 0;
  let destroyed = false;

  return {
    resize(nextWidth, nextHeight, dpr) {
      if (destroyed) return;
      width = nextWidth;
      height = nextHeight;
      app.renderer.resolution = dpr;
      app.renderer.resize(nextWidth, nextHeight);
    },

    draw(sample, paint: WaterPaint) {
      if (destroyed || width === 0 || height === 0) return;

      const points = surfacePoints(sample, width, height);
      const hue = toHex(paint.color);
      const radius = Math.max(0, Math.min(paint.radius, width / 2, height));
      const [near, middle, floor] = depthStops(paint.full);

      /*
       * The same three-stop gradient the 2D renderer draws, from the same shared recipe. A flat
       * fill here is what made a board come out with some glasses deep and some flat, which is how
       * this was reported: the water looking glitchy.
       *
       * The gradient is built per frame because its top follows the surface, and Pixi's fill
       * gradients are cheap objects rather than GPU resources.
       */
      const top = points[1] ?? height;
      // Alpha rides in the colour rather than beside it: a Pixi colour stop has no alpha field,
      // and `tint` is the same function the 2D renderer uses, so the two cannot disagree about
      // what "26% of this area's hue" means.
      const gradient = new FillGradient({
        type: 'linear',
        start: { x: 0, y: Math.max(0, Math.min(height, top)) },
        end: { x: 0, y: height },
        colorStops: [
          { offset: 0, color: tint(paint.color, near) },
          { offset: 0.55, color: tint(paint.color, middle) },
          { offset: 1, color: tint(paint.color, floor) },
        ],
        textureSpace: 'global',
      });

      body.clear();
      body.moveTo(0, top);
      for (let i = 0; i <= SURFACE_POINTS; i += 1) {
        body.lineTo(points[i * 2] ?? 0, points[i * 2 + 1] ?? height);
      }
      // Down the right wall, across the rounded floor, back up the left.
      body.lineTo(width, height - radius);
      body.quadraticCurveTo(width, height, width - radius, height);
      body.lineTo(radius, height);
      body.quadraticCurveTo(0, height, 0, height - radius);
      body.closePath();
      body.fill(gradient);

      surface.clear();
      surface.moveTo(points[0] ?? 0, points[1] ?? height);
      for (let i = 1; i <= SURFACE_POINTS; i += 1) {
        surface.lineTo(points[i * 2] ?? 0, points[i * 2 + 1] ?? height);
      }
      surface.stroke({ width: SURFACE_WIDTH, color: hue, alpha: SURFACE_ALPHA });

      sheen.clear();
      sheen.moveTo(points[0] ?? 0, (points[1] ?? height) + SHEEN_OFFSET);
      for (let i = 1; i <= SURFACE_POINTS; i += 1) {
        sheen.lineTo(points[i * 2] ?? 0, (points[i * 2 + 1] ?? height) + SHEEN_OFFSET);
      }
      sheen.stroke({ width: SHEEN_WIDTH, color: 0xffffff, alpha: SHEEN_ALPHA });

      app.render();
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      // `removeView: false` — the canvas belongs to React, not to Pixi. Letting Pixi destroy it
      // would leave the component holding a detached element.
      app.destroy({ removeView: false }, { children: true });
    },
  };
}
