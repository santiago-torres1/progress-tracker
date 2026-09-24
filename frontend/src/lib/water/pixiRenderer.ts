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

import { Application, Graphics } from 'pixi.js';
import type { WaterPaint, WaterRenderer } from './renderer';

const SURFACE_POINTS = 48;

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
  app.stage.addChild(body, surface);

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

      const points: number[] = [];
      for (let i = 0; i <= SURFACE_POINTS; i += 1) {
        const at = i / SURFACE_POINTS;
        const y = height - Math.min(1, Math.max(0, sample(at))) * height;
        points.push(at * width, y);
      }

      const hue = toHex(paint.color);
      const radius = Math.max(0, Math.min(paint.radius, width / 2, height));

      body.clear();
      body.moveTo(0, points[1] ?? height);
      for (let i = 0; i <= SURFACE_POINTS; i += 1) {
        body.lineTo(points[i * 2] ?? 0, points[i * 2 + 1] ?? height);
      }
      // Down the right wall, across the rounded floor, back up the left.
      body.lineTo(width, height - radius);
      body.quadraticCurveTo(width, height, width - radius, height);
      body.lineTo(radius, height);
      body.quadraticCurveTo(0, height, 0, height - radius);
      body.closePath();
      body.fill({ color: hue, alpha: paint.full ? 0.3 : 0.22 });

      surface.clear();
      surface.moveTo(points[0] ?? 0, points[1] ?? height);
      for (let i = 1; i <= SURFACE_POINTS; i += 1) {
        surface.lineTo(points[i * 2] ?? 0, points[i * 2 + 1] ?? height);
      }
      surface.stroke({ width: 2, color: hue, alpha: 0.85 });

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
