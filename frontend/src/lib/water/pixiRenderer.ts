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
 * one a given glass got is not something a reader can see. Every coordinate in here comes from
 * `renderer.ts`: this file owns the mask, the fills and the blend modes, and not one number about
 * what water looks like.
 */

import {
  EDGE_ALPHA_FAR,
  EDGE_ALPHA_NEAR,
  FLOOR_ALPHA,
  FLOOR_DEPTH,
  GLINT_ALPHA,
  SURFACE_ALPHA,
  SURFACE_WIDTH,
  UNDER_ALPHA,
  bodyStops,
  createCache,
  createSurfaceSampler,
  depthStops,
  nothingToDraw,
  traceBody,
  traceFloorLight,
  traceGlint,
  traceSurface,
  traceUnderBand,
  traceVessel,
  traceWallStrip,
  tint,
  underDepthPx,
  wallStripPx,
  type SurfaceSampler,
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
  let Container: typeof import('pixi.js').Container;
  let Graphics: typeof import('pixi.js').Graphics;
  let FillGradient: typeof import('pixi.js').FillGradient;
  try {
    ({ Application, Container, Graphics, FillGradient } = await import('pixi.js'));
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

  /*
   * One mask for the whole liquid, which is the mirror of canvas's single `clip`.
   *
   * Without it every layer would have to know about the vessel's rounded corners, and the wall
   * strips and the floor light — the two that reach the bottom — would square them off. With it,
   * each layer is the same path the 2D renderer draws and nothing else.
   */
  const liquid = new Container();
  const vessel = new Graphics();
  const body = new Graphics();
  const near = new Graphics();
  const far = new Graphics();
  const under = new Graphics();
  const line = new Graphics();
  const glint = new Graphics();
  const floor = new Graphics();

  // Light is added to what is underneath it, never mixed into it — the same `lighter` the 2D
  // renderer switches to for exactly these two layers.
  glint.blendMode = 'add';
  floor.blendMode = 'add';

  liquid.addChild(vessel, body, near, far, under, line, glint, floor);
  liquid.mask = vessel;
  app.stage.addChild(liquid);

  let width = 0;
  let height = 0;
  let box = '';
  let maskKey = '';
  let sampler: SurfaceSampler | null = null;
  let destroyed = false;

  const bodyFill = createCache<import('pixi.js').FillGradient>();
  const nearFill = createCache<import('pixi.js').FillGradient>();
  const farFill = createCache<import('pixi.js').FillGradient>();
  const floorFill = createCache<import('pixi.js').FillGradient>();

  return {
    resize(nextWidth, nextHeight, dpr) {
      if (destroyed) return;
      width = nextWidth;
      height = nextHeight;
      app.renderer.resolution = dpr;
      app.renderer.resize(nextWidth, nextHeight);
      box = `${nextWidth}x${nextHeight}`;
      sampler = createSurfaceSampler(nextWidth, nextHeight);
    },

    draw(sample, paint: WaterPaint) {
      if (destroyed || width === 0 || height === 0 || sampler === null) return;

      body.clear();
      near.clear();
      far.clear();
      under.clear();
      line.clear();
      glint.clear();
      floor.clear();

      const surface = sampler.measure(sample, paint);
      // Still rendered, not returned early: the frame before this one is on the screen until
      // something replaces it, so an emptied glass has to be drawn as empty.
      if (nothingToDraw(surface)) {
        app.render();
        return;
      }

      const hue = toHex(paint.color);
      const { depthPx } = surface;
      const strip = wallStripPx(width);

      const wantMask = `${box}|${paint.radius}`;
      if (maskKey !== wantMask) {
        vessel.clear();
        traceVessel(vessel, width, height, paint.radius);
        vessel.fill({ color: 0xffffff });
        maskKey = wantMask;
      }

      const rest = Math.max(0, Math.min(height, height - depthPx));
      const stops = bodyStops(depthStops(paint), depthPx);
      const gradient = bodyFill(
        `${box}|${paint.color}|${rest}|${stops.map((s) => s.alpha).join()}`,
        () =>
          new FillGradient({
            type: 'linear',
            start: { x: 0, y: rest },
            end: { x: 0, y: height },
            colorStops: stops.map((stop) => ({
              offset: stop.offset,
              color: tint(paint.color, stop.alpha),
            })),
            textureSpace: 'global',
          }),
      );

      traceBody(body, surface);
      body.fill(gradient);

      if (traceWallStrip(near, surface, 'near')) {
        near.fill(
          nearFill(`${box}|${paint.color}`, () =>
            edgeGradient(FillGradient, paint.color, 0, strip, EDGE_ALPHA_NEAR),
          ),
        );
      }
      if (traceWallStrip(far, surface, 'far')) {
        far.fill(
          farFill(`${box}|${paint.color}`, () =>
            edgeGradient(FillGradient, paint.color, width, width - strip, EDGE_ALPHA_FAR),
          ),
        );
      }

      if (traceUnderBand(under, surface, underDepthPx(depthPx))) {
        under.fill({ color: hue, alpha: UNDER_ALPHA });
      }

      traceSurface(line, surface.points);
      line.stroke({ width: SURFACE_WIDTH, color: hue, alpha: SURFACE_ALPHA, join: 'round' });

      if (traceGlint(glint, surface)) {
        glint.fill({ color: 0xffffff, alpha: GLINT_ALPHA });
      }
      if (traceFloorLight(floor, surface)) {
        floor.fill(
          floorFill(
            box,
            () =>
              new FillGradient({
                type: 'linear',
                start: { x: 0, y: height - FLOOR_DEPTH },
                end: { x: 0, y: height },
                colorStops: [
                  { offset: 0, color: 'rgba(255, 255, 255, 0)' },
                  { offset: 1, color: `rgba(255, 255, 255, ${FLOOR_ALPHA})` },
                ],
                textureSpace: 'global',
              }),
          ),
        );
      }

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

/** A wall strip's gradient: the area colour at the wall, nothing at the band's inner edge. */
function edgeGradient(
  FillGradient: typeof import('pixi.js').FillGradient,
  color: string,
  wall: number,
  inner: number,
  alpha: number,
): import('pixi.js').FillGradient {
  return new FillGradient({
    type: 'linear',
    start: { x: wall, y: 0 },
    end: { x: inner, y: 0 },
    colorStops: [
      { offset: 0, color: tint(color, alpha) },
      { offset: 1, color: tint(color, 0) },
    ],
    textureSpace: 'global',
  });
}
