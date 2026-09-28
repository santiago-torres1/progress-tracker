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
  /**
   * Alpha at the surface, mid-depth and floor, read from the theme's own tokens.
   * Omitted, `depthStops` supplies the fallback.
   */
  stops?: readonly [number, number, number];
  /**
   * Where the surface rests, 0–1, ignoring whatever the waves are doing.
   *
   * The gradient is anchored to THIS and not to the surface's height at the left wall, which is
   * what it used to use — a point that bobs every frame, so the whole body brightened and dimmed
   * as each wave went past. A pump, not a shimmer.
   */
  level: number;
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
export const SURFACE_POINTS = 48;

/*
 * THE RECIPE, IN ONE PLACE, BECAUSE THERE ARE TWO RENDERERS.
 *
 * Both of them below and in `pixiRenderer.ts` draw the same liquid, and for a while they did not:
 * Pixi filled a flat 22% while canvas drew a three-stop gradient with a highlight on the surface.
 * Which tiles got which depended on the order they mounted, so a board came out with some glasses
 * deep and some flat — and it was reported as the water looking glitchy, which it was.
 *
 * Numbers that describe the liquid live here and are imported by both. A renderer decides HOW to
 * put them on a screen; it does not get an opinion about what the water looks like.
 */

/**
 * Alpha of the area colour at the surface, mid-depth and floor.
 *
 * A FALLBACK ONLY. The real numbers are `--tint-top` / `-bot` / `-deep` in `tokens.css`, which
 * differ between light and dark, and the canvas now reads them — because it was drawing one recipe
 * for both themes and so drew a different liquid from the CSS water beside it. Toggling reduced
 * motion changed the colour of the water, which is not a thing that should happen.
 *
 * The full-glass floor is why this matters rather than merely being untidy: the canvas drew 34%,
 * and 34% is the exact value the design pass rejected on contrast, having measured a value line at
 * 4.22:1 against it. Every tile the canvas drives was drawing the rejected one.
 *
 * These values are the dark theme's, and are used only where no custom property can be read —
 * jsdom, chiefly, where nothing is painted anyway.
 */
export const DEPTH_STOPS = {
  resting: [0.13, 0.24, 0.28],
  full: [0.18, 0.27, 0.3],
} as const;

/** Where the three stops sit down the body, matching the CSS gradient rather than guessing. */
export const DEPTH_OFFSETS = [0, 0.78, 1] as const;

/**
 * The surface line: the one full-strength edge, so "where the water is" is never in doubt.
 *
 * Thinner and stronger than it was. With a dark band beneath it and a meniscus hooking up at each
 * wall, a 2px line became the thickest of three parallel things and started reading as a border —
 * and, on a small tile, as a strike through the goal's own title.
 */
export const SURFACE_ALPHA = 0.9;
export const SURFACE_WIDTH = 1.5;

/**
 * The dark band immediately under the surface.
 *
 * This is what gives a surface thickness rather than making it a boundary between two fills — it
 * is the single cheapest thing on the list and the one that most changes whether this reads as
 * liquid. Flat, not a gradient: the waves are a few pixels on a small tile, the same size as the
 * band, so a gradient anchored to the resting level would vanish at every crest.
 */
export const UNDER_DEPTH = 5;
export const UNDER_ALPHA = 0.18;

/**
 * The meniscus: water wets the glass and climbs it.
 *
 * An exponential decay from each wall, which is the actual shape the physics gives, normalised so
 * it reaches exactly zero at the band's edge — without that there is a fifth-of-a-pixel step where
 * the hook meets the flat, and a step is a visible line.
 *
 * It is added when the surface is sampled and never fed back into the field: it is a wetting film,
 * not volume, so the invariant that the simulation moves water without making any is untouched.
 */
export const MENISCUS_WIDTH = 13;
export const MENISCUS_RISE = 4.5;
export const MENISCUS_SHAPE = 3.2;

/** The stops for a glass at this level, surface first: the theme's if it gave us any. */
export function depthStops(paint: {
  full: boolean;
  stops?: readonly [number, number, number];
}): readonly [number, number, number] {
  return paint.stops ?? (paint.full ? DEPTH_STOPS.full : DEPTH_STOPS.resting);
}

/**
 * The surface, as `[x, y]` pairs across the glass.
 *
 * Shared so that both renderers trace the same curve from the same sampler — a difference of one
 * point between them would show up as the two halves of a board rippling slightly out of step.
 */
export function surfacePoints(
  sample: (at: number) => number,
  width: number,
  height: number,
): number[] {
  const band = Math.min(MENISCUS_WIDTH, width * 0.18);
  const points: number[] = [];

  for (const at of samplePositions(width, band)) {
    const level = Math.min(1, Math.max(0, sample(at)));
    const y = height - level * height;
    points.push(at * width, y - meniscusAt(at * width, width, band, y, height));
  }
  return points;
}

/**
 * Where along the glass to sample, 0–1.
 *
 * Denser inside each wall, because that is the only place anything happens quickly. Evenly spaced,
 * a 13px meniscus on a small tile would be two segments and come out as a kink rather than a
 * curve. The extra points are placed quadratically so they crowd towards the wall itself.
 */
function samplePositions(width: number, band: number): number[] {
  const positions: number[] = [];
  const edge = width === 0 ? 0 : band / width;

  for (let j = 0; j < 7; j += 1) positions.push(edge * (j / 7) ** 2);
  for (let i = 0; i <= SURFACE_POINTS; i += 1) positions.push(i / SURFACE_POINTS);
  for (let j = 6; j >= 0; j -= 1) positions.push(1 - edge * (j / 7) ** 2);

  return positions.sort((a, b) => a - b);
}

/**
 * The three path methods canvas and Pixi happen to agree on.
 *
 * Shared so the surface is traced by one piece of code for both. Sixty-odd straight segments show
 * a facet on every crest, which is the loudest "drawn by a computer" tell in the whole picture, so
 * this runs a quadratic through the midpoints instead. It costs nothing: same number of commands.
 */
export interface PathSink {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): unknown;
}

/** Trace the surface across the glass, optionally pushed down by `dy`. */
export function traceSurface(sink: PathSink, points: readonly number[], dy = 0): void {
  const count = points.length / 2;
  if (count < 2) return;

  sink.moveTo(points[0] ?? 0, (points[1] ?? 0) + dy);
  for (let i = 1; i < count - 1; i += 1) {
    const cx = points[i * 2] ?? 0;
    const cy = (points[i * 2 + 1] ?? 0) + dy;
    const nx = points[(i + 1) * 2] ?? 0;
    const ny = (points[(i + 1) * 2 + 1] ?? 0) + dy;
    sink.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
  }
  sink.lineTo(points[(count - 1) * 2] ?? 0, (points[(count - 1) * 2 + 1] ?? 0) + dy);
}

/** How far the water climbs the wall at this x, in pixels. Zero outside the two bands. */
function meniscusAt(x: number, width: number, band: number, y: number, height: number): number {
  if (band <= 0) return 0;

  const fromWall = Math.min(x, width - x);
  if (fromWall >= band) return 0;

  // Normalised so the hook reaches exactly zero where the band ends, rather than a fraction above.
  const t = fromWall / band;
  const floor = Math.exp(-MENISCUS_SHAPE);
  const shape = (Math.exp(-MENISCUS_SHAPE * t) - floor) / (1 - floor);

  // No climb on a glass with nothing in it, and less of one at the brim where there is no wall
  // left to climb.
  const depth = Math.min(1, (height - y) / 10);
  const headroom = y < MENISCUS_RISE ? 0.55 : 1;

  return MENISCUS_RISE * shape * depth * headroom;
}

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

      // Sampled ONCE. This used to walk the sampler for every layer it drew.
      const points = surfacePoints(sample, width, height);
      const last = points.length - 2;

      // The liquid lives inside the glass, so it is clipped to the vessel's own bottom corners.
      ctx.save();
      ctx.beginPath();
      roundedBottom(ctx, width, height, paint.radius);
      ctx.clip();

      // --- the body ---------------------------------------------------------------------
      ctx.beginPath();
      traceSurface(ctx, points);
      ctx.lineTo(points[last] ?? width, height);
      ctx.lineTo(points[0] ?? 0, height);
      ctx.closePath();

      // Anchored to the resting level, not to the surface at the left wall: see `WaterPaint.level`.
      const rest = height - Math.min(1, Math.max(0, paint.level)) * height;
      const [near, middle, floor] = depthStops(paint);
      const body = ctx.createLinearGradient(0, Math.max(0, Math.min(height, rest)), 0, height);
      body.addColorStop(DEPTH_OFFSETS[0], tint(paint.color, near));
      body.addColorStop(DEPTH_OFFSETS[1], tint(paint.color, middle));
      body.addColorStop(DEPTH_OFFSETS[2], tint(paint.color, floor));
      ctx.fillStyle = body;
      ctx.fill();

      // --- the band under the surface, which is what gives it thickness ---------------------
      ctx.beginPath();
      traceSurface(ctx, points, UNDER_DEPTH);
      for (let i = points.length / 2 - 1; i >= 0; i -= 1) {
        ctx.lineTo(points[i * 2] ?? 0, points[i * 2 + 1] ?? 0);
      }
      ctx.closePath();
      ctx.fillStyle = tint(paint.color, UNDER_ALPHA);
      ctx.fill();

      // --- the surface itself ---------------------------------------------------------------
      ctx.beginPath();
      traceSurface(ctx, points);
      ctx.lineWidth = SURFACE_WIDTH;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = tint(paint.color, SURFACE_ALPHA);
      ctx.stroke();

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
export function tint(color: string, alpha: number): string {
  const parts = color.match(/-?\d+(\.\d+)?/g);
  if (parts === null || parts.length < 3) return color;
  const [r, g, b] = parts;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
