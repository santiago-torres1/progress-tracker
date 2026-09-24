/*
 * Drawing a field of water into a canvas the size of one tile.
 *
 * The shape is the same one the CSS already draws — a body of colour with a surface line and a
 * meniscus climbing each wall — except the top edge is now a curve sampled from `WaterField`
 * instead of a straight line. Everything else about the tile (its walls, its rim, its shadow, its
 * copy) stays in CSS where the design lives; this layer is only the liquid.
 *
 * Colour arrives as a resolved rgb string, not a token name, because the tile's area colour is a
 * CSS custom property and canvas cannot read one. The caller does the lookup once per tile.
 */

export interface WaterPaint {
  /** The area colour, already resolved — `rgb(46 125 87)`. */
  color: string;
  /** 0–1. The water gets one step deeper when the glass is at the brim, as the tokens do. */
  full: boolean;
  /** Radius of the tile's bottom corners, in CSS pixels, so the liquid sits inside the glass. */
  radius: number;
}

export interface WaterRenderer {
  /** Match the backing store to the element's box and the display's pixel ratio. */
  resize(width: number, height: number, dpr: number): void;
  /** `sample(x)` returns the level at x (0–1 across the glass) as 0–1 up from the bottom. */
  draw(sample: (at: number) => number, paint: WaterPaint): void;
  destroy(): void;
}

/** How many points the surface curve is drawn with. Independent of the field's column count. */
const SURFACE_POINTS = 48;

/**
 * Canvas 2D.
 *
 * Every browser has it, there is no limit on how many of these can exist at once, and a filled
 * path with a gradient costs a fraction of a millisecond at tile size. That last point is why this
 * is not a compromise: there are only ever a few hundred pixels of liquid to move.
 */
export function createCanvasRenderer(canvas: HTMLCanvasElement): WaterRenderer | null {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;

  let width = 0;
  let height = 0;

  return {
    resize(nextWidth, nextHeight, dpr) {
      width = nextWidth;
      height = nextHeight;
      canvas.width = Math.max(1, Math.round(nextWidth * dpr));
      canvas.height = Math.max(1, Math.round(nextHeight * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    draw(sample, paint) {
      if (width === 0 || height === 0) return;
      ctx.clearRect(0, 0, width, height);

      // The liquid lives inside the glass, so it is clipped to the vessel's own bottom corners.
      ctx.save();
      ctx.beginPath();
      roundedBottom(ctx, width, height, paint.radius);
      ctx.clip();

      // The surface, left wall to right wall.
      ctx.beginPath();
      ctx.moveTo(0, height);
      let firstY = height;
      for (let i = 0; i <= SURFACE_POINTS; i += 1) {
        const at = i / SURFACE_POINTS;
        const y = height - Math.min(1, Math.max(0, sample(at))) * height;
        if (i === 0) {
          firstY = y;
          ctx.lineTo(0, y);
        } else {
          ctx.lineTo(at * width, y);
        }
      }
      ctx.lineTo(width, height);
      ctx.closePath();

      const top = Math.max(0, Math.min(height, firstY));
      const body = ctx.createLinearGradient(0, top, 0, height);
      body.addColorStop(0, tint(paint.color, paint.full ? 0.18 : 0.13));
      body.addColorStop(0.55, tint(paint.color, paint.full ? 0.27 : 0.2));
      body.addColorStop(1, tint(paint.color, paint.full ? 0.34 : 0.26));
      ctx.fillStyle = body;
      ctx.fill();

      // The surface line: the one full-strength edge, so "where the water is" is never in doubt.
      ctx.beginPath();
      for (let i = 0; i <= SURFACE_POINTS; i += 1) {
        const at = i / SURFACE_POINTS;
        const y = height - Math.min(1, Math.max(0, sample(at))) * height;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(at * width, y);
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = tint(paint.color, 0.85);
      ctx.stroke();

      // A sheet of light lying ON the surface — the thing that reads as "liquid" rather than
      // "area of colour with a wavy top".
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      for (let i = 0; i <= SURFACE_POINTS; i += 1) {
        const at = i / SURFACE_POINTS;
        const y = height - Math.min(1, Math.max(0, sample(at))) * height + 3;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(at * width, y);
      }
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';

      ctx.restore();
    },

    destroy() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

/** The vessel's floor: square at the top, rounded where the glass is. */
function roundedBottom(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, width / 2, height));
  ctx.moveTo(0, 0);
  ctx.lineTo(width, 0);
  ctx.lineTo(width, height - radius);
  ctx.quadraticCurveTo(width, height, width - radius, height);
  ctx.lineTo(radius, height);
  ctx.quadraticCurveTo(0, height, 0, height - radius);
  ctx.closePath();
}

/**
 * The area colour at a given strength, over whatever is behind it.
 *
 * `color` arrives as `rgb(r g b)` or `rgb(r, g, b)` — both spellings come back from
 * `getComputedStyle` depending on the browser — so the digits are pulled out rather than parsed
 * strictly. Anything unreadable falls back to the string as given at full strength, which is
 * visible and wrong rather than invisible and wrong.
 */
function tint(color: string, alpha: number): string {
  const parts = color.match(/-?\d+(\.\d+)?/g);
  if (parts === null || parts.length < 3) return color;
  const [r, g, b] = parts;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
