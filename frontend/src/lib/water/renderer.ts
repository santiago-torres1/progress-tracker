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
 * Numbers that describe the liquid live here and are imported by both, and so does every path:
 * a renderer decides HOW to put a shape on a screen and owns nothing about what the shape is.
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

/**
 * Where the body's stops sit down the liquid.
 *
 * Four, not three. The water immediately under the surface is the LIGHTEST part of the liquid,
 * because you are looking through almost none of it; with three stops the topmost one also had to
 * serve the first third of the glass, so the body started too dark and the surface line had
 * nothing to sit against.
 */
export const DEPTH_OFFSETS = [0, 0.14, 0.78, 1] as const;

/** How much lighter the film just under the surface is than the water below it. */
export const NEAR_SURFACE_LIGHTEN = 0.72;

/** Below this depth the middle stops are dropped: four stops inside 8px is mud, not shading. */
export const SHALLOW_PX = 8;

/**
 * The surface line: the one full-strength edge, so "where the water is" is never in doubt.
 *
 * Thinner and stronger than it was. With a dark band beneath it and a meniscus hooking up at each
 * wall, a 2px line became the thickest of three parallel things and started reading as a border —
 * and, on a small tile, as a strike through the goal's own title.
 *
 * Its strength never varies along its length, deliberately: the line is the datum, and a line that
 * is brighter in some places than others says the number is less certain there. Everything that
 * varies goes into the glint, which is light, and light is allowed to be uneven.
 */
export const SURFACE_ALPHA = 0.9;
export const SURFACE_WIDTH = 1.5;

/**
 * How close to the rim the surface is allowed to come.
 *
 * A glass at the brim reads as brimming rather than as clipped, and a wave in a nearly-full glass
 * keeps its shape instead of being flattened against the top edge of the canvas.
 */
export const SURFACE_INSET = 1.5;

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

/** At the brim the rim holds the water and the hook flattens. */
export const MENISCUS_FULL = 0.55;

/** No hook below `OFF` pixels of water, full hook by `IN`, linear between. */
export const MENISCUS_OFF = 2;
export const MENISCUS_IN = 10;

/**
 * Absorption at the walls: two narrow strips, never a second fill of the whole body.
 *
 * Sideways is the same fact as downwards — at the wall you are looking through the liquid AND
 * through the glass — and it is why the CSS body has a horizontal gradient. The canvas had nothing
 * horizontal at all, so its liquid had no sides. Strips rather than a second body fill because the
 * effect occupies a fifth of the tile and a second body fill costs all of it.
 *
 * They follow the meniscus, which gives the consequence worth having: the liquid looks thicker
 * where it climbs the wall, exactly as it does in a glass.
 */
export const EDGE_WIDTH = 0.09;
export const EDGE_MAX = 26;
export const EDGE_ALPHA_NEAR = 0.1;
export const EDGE_ALPHA_FAR = 0.07;

/**
 * The glint: light on the flanks of the waves, carried by THICKNESS rather than by colour.
 *
 * A facet of the surface tilted toward the window reflects it at you and a facet tilted away does
 * not. The window in this app is top-left — `--room-light` and the whole `--glass-*` family assume
 * it — so the facets that catch it are the ones descending to the right.
 *
 * Constant alpha, varying width, one fill: that is what keeps it to a single polygon instead of
 * sixty-three strokes, and it is also what makes it read as light rather than as a coloured line.
 * The slope comes from the WAVES ALONE and never from the meniscus, or both walls would glint
 * permanently and the two hooks would become fixed bright marks — furniture, not light.
 *
 * Still water keeps `GLINT_FLOOR` of it: a half-pixel hairline along the whole surface. Moving
 * water lights the right-hand flank of every crest, and because crests travel, the light travels.
 *
 * `GLINT_SLOPE` is MEASURED, not chosen. The spec's 0.14 (about 8°) was an estimate of a
 * distribution nobody had looked at: this field's peak slope is 0.04 after a pour and 0.36–0.50
 * during a drag, a spread of more than ten to one. At 0.14 a pour — the motion that happens every
 * time somebody completes anything — reached 28% of the width and read as nothing. At 0.06 a pour
 * reaches two thirds and a drag saturates, which is the right way round: a shoved glass SHOULD
 * have bright flanks.
 */
export const GLINT_SLOPE = 0.06;
export const GLINT_WIDTH = 2.6;
export const GLINT_FLOOR = 0.18;
export const GLINT_ALPHA = 0.13;
export const GLINT_DROP = 0.3;

/**
 * Light focused on the floor of the glass.
 *
 * A crest is a converging lens for the light coming down through it, so the base of a glass with
 * moving water carries bright bands that slide about. Intensity goes as `1 / (1 + k·d·h'')`, i.e.
 * bright where the surface curves downward — under the crests — so it is a second difference of the
 * surface, and the second difference is only meaningful across the evenly spaced samples.
 *
 * Its top edge undulates; the gradient beneath it is static and cached. Nine pixels tall, so the
 * fill area is nothing. It is NOT displaced sideways by the local slope, even though that is what
 * really happens: the offset is under a pixel at these amplitudes and it costs a second walk.
 *
 * This is a different thing from `.goal-tile__glass::after`, the CSS caustic that paints over the
 * canvas: that one is the glow leaving through the base, this one is light being focused inside it.
 *
 * `FLOOR_FOCUS` is measured the same way and for the same reason. The spec's 0.012 was twenty
 * times this field's actual curvature after a pour (peak -d2 of 0.00054) and about equal to its
 * peak during a drag, so the effect drew a band of perfectly even light and nothing else — which
 * is precisely what it exists not to be. Probing the drawn pixels is what found that: crest and
 * trough came back identical to the byte.
 */
export const FLOOR_DEPTH = 9;
export const FLOOR_ALPHA = 0.1;
export const FLOOR_FOCUS = 0.006;
export const FLOOR_OFF = 4;
export const FLOOR_IN = 12;

/**
 * Below this much water, anywhere along the surface, nothing is drawn at all.
 *
 * An empty glass is empty — not a two-pixel line lying on its floor with a dark band under it.
 * Tested every frame against the deepest point of the surface rather than against the resting
 * level, so a pour still starts from nothing and the first wave of it draws.
 */
export const EMPTY_PX = 1;

/** The stops for a glass at this level, surface first: the theme's if it gave us any. */
export function depthStops(paint: {
  full: boolean;
  stops?: readonly [number, number, number];
}): readonly [number, number, number] {
  return paint.stops ?? (paint.full ? DEPTH_STOPS.full : DEPTH_STOPS.resting);
}

export interface BodyStop {
  /** 0 at the resting surface, 1 at the floor. */
  offset: number;
  alpha: number;
}

/** The body gradient's stops, top first. Two of them in water too shallow to shade. */
export function bodyStops(
  stops: readonly [number, number, number],
  depthPx: number,
): readonly BodyStop[] {
  const [near, middle, deep] = stops;
  if (depthPx < SHALLOW_PX) {
    return [
      { offset: DEPTH_OFFSETS[0], alpha: near },
      { offset: DEPTH_OFFSETS[3], alpha: deep },
    ];
  }
  return [
    { offset: DEPTH_OFFSETS[0], alpha: near * NEAR_SURFACE_LIGHTEN },
    { offset: DEPTH_OFFSETS[1], alpha: near },
    { offset: DEPTH_OFFSETS[2], alpha: middle },
    { offset: DEPTH_OFFSETS[3], alpha: deep },
  ];
}

/** How thick the band under the surface can be without reaching the floor. */
export function underDepthPx(depthPx: number): number {
  return Math.max(0, Math.min(UNDER_DEPTH, depthPx - 0.5));
}

/** How wide each wall strip is, in pixels. */
export function wallStripPx(width: number): number {
  return Math.min(width * EDGE_WIDTH, EDGE_MAX);
}

/**
 * One frame of the surface, as geometry.
 *
 * The arrays are REUSED between frames — a board can hold a hundred of these and sixty frames a
 * second of fresh arrays is work for the garbage collector instead of for the picture. Read what
 * you need and draw; never keep one.
 */
export interface Surface {
  /** `x, y` pairs across the glass, in pixels, with the meniscus already in the `y`. */
  readonly points: readonly number[];
  /** How far the meniscus lifted each point. `y + hook[i]` is the wave on its own. */
  readonly hook: readonly number[];
  /** Indices into `points` of the evenly spaced samples, ascending. */
  readonly evenIndex: readonly number[];
  readonly count: number;
  readonly width: number;
  readonly height: number;
  /** The resting depth in pixels — what the gradient is anchored to. */
  readonly depthPx: number;
  /** The deepest the water gets anywhere along the surface, waves included. */
  readonly deepestPx: number;
  /** Half-width of the meniscus band, in pixels. */
  readonly band: number;
  readonly full: boolean;
}

/** The same thing before it is handed out, so nothing here needs a cast to write to it. */
interface MutableSurface {
  points: number[];
  hook: number[];
  evenIndex: number[];
  count: number;
  width: number;
  height: number;
  depthPx: number;
  deepestPx: number;
  band: number;
  full: boolean;
}

export interface SurfaceSampler {
  /** Walk the sampler once and return the shared, reused `Surface`. */
  measure(sample: (at: number) => number, paint: WaterPaint): Surface;
}

/**
 * Build a sampler for a box of this size.
 *
 * Everything that depends only on the box — where to sample, how wide the meniscus band is, the
 * arrays themselves — is decided here, once, on resize. The per-frame walk then does arithmetic
 * and nothing else.
 */
export function createSurfaceSampler(width: number, height: number): SurfaceSampler {
  const band = Math.min(MENISCUS_WIDTH, width * 0.18);
  const { at, evenIndex } = samplePositions(width === 0 ? 0 : band / width);
  const count = at.length;

  const points = new Array<number>(count * 2).fill(0);
  const hook = new Array<number>(count).fill(0);
  const surface: MutableSurface = {
    points,
    hook,
    evenIndex,
    count,
    width,
    height,
    depthPx: 0,
    deepestPx: 0,
    band,
    full: false,
  };

  return {
    measure(sample, paint) {
      const level = clamp01(paint.level);
      const menScale = paint.full ? MENISCUS_FULL : 1;
      let deepest = 0;

      for (let i = 0; i < count; i += 1) {
        const position = at[i] ?? 0;
        const x = position * width;
        // Clamped away from the rim so a brimming glass reads as brimming and a wave in one keeps
        // its shape instead of being flattened against the top of the canvas.
        const y = Math.max(SURFACE_INSET, height - clamp01(sample(position)) * height);
        const climb = meniscusAt(x, width, band, y, height) * menScale;

        points[i * 2] = x;
        points[i * 2 + 1] = y - climb;
        hook[i] = climb;
        deepest = Math.max(deepest, height - (y - climb));
      }

      surface.depthPx = level * height;
      surface.deepestPx = deepest;
      surface.full = paint.full;
      return surface;
    },
  };
}

/** Is there so little water that the honest picture is no picture? */
export function nothingToDraw(surface: Surface): boolean {
  return surface.count < 2 || surface.width === 0 || surface.deepestPx < EMPTY_PX;
}

/**
 * Where along the glass to sample, 0–1, and which of those are the evenly spaced ones.
 *
 * Denser inside each wall, because that is the only place anything happens quickly: evenly spaced,
 * a 13px meniscus on a small tile would be two segments and come out as a kink rather than a
 * curve. The extra points are placed quadratically so they crowd towards the wall itself.
 *
 * The even ones are tracked because a second difference — which is what the light on the floor is
 * made of — is only meaningful across samples a fixed distance apart.
 */
function samplePositions(edge: number): { at: number[]; evenIndex: number[] } {
  // Ascending, and entirely below the uniform grid's second point on any tile we draw, so the
  // merge below is a single walk. `j` starts at 1: `j = 0` would duplicate the grid's own end.
  const wall: number[] = [];
  for (let j = 1; j < 7; j += 1) wall.push(edge * (j / 7) ** 2);
  for (let j = 6; j >= 1; j -= 1) wall.push(1 - edge * (j / 7) ** 2);

  const at: number[] = [];
  const evenIndex: number[] = [];
  let w = 0;

  for (let i = 0; i <= SURFACE_POINTS; i += 1) {
    const next = i / SURFACE_POINTS;
    while (w < wall.length && (wall[w] ?? 1) < next) {
      at.push(wall[w] ?? 0);
      w += 1;
    }
    evenIndex.push(at.length);
    at.push(next);
  }
  for (; w < wall.length; w += 1) at.push(wall[w] ?? 0);

  return { at, evenIndex };
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
  const fade = clamp01((height - y - MENISCUS_OFF) / (MENISCUS_IN - MENISCUS_OFF));
  const headroom = y < MENISCUS_RISE ? 0.55 : 1;

  return MENISCUS_RISE * shape * fade * headroom;
}

/**
 * The four path methods canvas and Pixi happen to agree on.
 *
 * Every shape in the liquid is traced through this, by one piece of code, for both renderers. Two
 * implementations of one picture drifted once already and shipped a board with eight flat glasses
 * among deep ones; the fix is that a renderer never owns a coordinate.
 */
export interface PathSink {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): unknown;
  closePath(): unknown;
}

/**
 * Trace the surface across the glass, optionally pushed down by `dy`.
 *
 * Sixty-odd straight segments show a facet on every crest, which is the loudest "drawn by a
 * computer" tell in the whole picture, so this runs a quadratic through the midpoints instead. It
 * costs nothing: the same number of commands.
 */
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

/** The vessel itself: square at the top, rounded where the glass is. The liquid is clipped to it. */
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

/** The body of the liquid: the surface curve, and straight down to the floor. */
export function traceBody(sink: PathSink, surface: Surface): void {
  const { points, count, height } = surface;
  traceSurface(sink, points);
  sink.lineTo(points[(count - 1) * 2] ?? surface.width, height);
  sink.lineTo(points[0] ?? 0, height);
  sink.closePath();
}

/** The band under the surface: the curve, and the curve again `depth` lower. */
export function traceUnderBand(sink: PathSink, surface: Surface, depth: number): boolean {
  if (depth <= 0) return false;
  const { points, count } = surface;
  traceSurface(sink, points, depth);
  for (let i = count - 1; i >= 0; i -= 1) sink.lineTo(points[i * 2] ?? 0, points[i * 2 + 1] ?? 0);
  sink.closePath();
  return true;
}

/**
 * One wall strip: the surface where it is inside the band, then down to the floor.
 *
 * The inner edge is interpolated rather than snapped to the nearest sample, so the strip's width is
 * the width it is supposed to be and not a sample's rounding of it.
 */
export function traceWallStrip(sink: PathSink, surface: Surface, side: 'near' | 'far'): boolean {
  const { points, count, width, height } = surface;
  const strip = wallStripPx(width);
  if (strip <= 0 || count < 2) return false;

  const inner = side === 'near' ? strip : width - strip;

  if (side === 'near') {
    sink.moveTo(points[0] ?? 0, points[1] ?? 0);
    for (let i = 1; i < count; i += 1) {
      const x = points[i * 2] ?? 0;
      if (x >= inner) break;
      sink.lineTo(x, points[i * 2 + 1] ?? 0);
    }
    sink.lineTo(inner, surfaceYAt(surface, inner));
    sink.lineTo(inner, height);
    sink.lineTo(0, height);
  } else {
    sink.moveTo(inner, surfaceYAt(surface, inner));
    for (let i = 0; i < count; i += 1) {
      const x = points[i * 2] ?? 0;
      if (x <= inner) continue;
      sink.lineTo(x, points[i * 2 + 1] ?? 0);
    }
    sink.lineTo(width, height);
    sink.lineTo(inner, height);
  }

  sink.closePath();
  return true;
}

/**
 * The glint, as one ribbon: `y - width` along the top, `y + GLINT_DROP` back along the bottom.
 *
 * Returns false when there is nothing to light, so neither renderer pays for an empty fill.
 */
export function traceGlint(sink: PathSink, surface: Surface): boolean {
  const { points, count, deepestPx } = surface;
  if (count < 2 || deepestPx <= MENISCUS_OFF) return false;

  for (let i = 0; i < count; i += 1) {
    const x = points[i * 2] ?? 0;
    const y = points[i * 2 + 1] ?? 0;
    const w = glintWidth(surface, i);
    if (i === 0) sink.moveTo(x, y - w);
    else sink.lineTo(x, y - w);
  }
  for (let i = count - 1; i >= 0; i -= 1) {
    sink.lineTo(points[i * 2] ?? 0, (points[i * 2 + 1] ?? 0) + GLINT_DROP);
  }
  sink.closePath();
  return true;
}

/**
 * How thick the light is at one point: the wave's slope there, and two things that damp it.
 *
 * Exported because it is the whole of the effect — a test can read it directly rather than
 * inferring it from a path.
 */
export function glintWidth(surface: Surface, i: number): number {
  const { points, hook, count, height } = surface;
  const previous = Math.max(0, i - 1);
  const next = Math.min(count - 1, i + 1);
  const run = (points[next * 2] ?? 0) - (points[previous * 2] ?? 0);
  if (run <= 0) return 0;

  // The wave on its own: `y` carries the meniscus, and a hook is not a facet.
  const rise =
    (points[next * 2 + 1] ?? 0) +
    (hook[next] ?? 0) -
    ((points[previous * 2 + 1] ?? 0) + (hook[previous] ?? 0));

  const y = points[i * 2 + 1] ?? 0;
  const lit = clamp01(rise / run / GLINT_SLOPE);
  const rim = clamp01((y - 0.5) / GLINT_WIDTH);
  const puddle = clamp01((height - y - MENISCUS_OFF) / (MENISCUS_IN - MENISCUS_OFF));

  return GLINT_WIDTH * (GLINT_FLOOR + (1 - GLINT_FLOOR) * lit) * rim * puddle;
}

/**
 * The light on the floor: a ribbon whose top edge rises under every crest.
 *
 * Returns false on water too shallow to focus anything, which is also what stops a nearly-empty
 * glass having a bright base.
 */
export function traceFloorLight(sink: PathSink, surface: Surface): boolean {
  const { points, hook, evenIndex, width, height, depthPx } = surface;
  const settle = clamp01((depthPx - FLOOR_OFF) / (FLOOR_IN - FLOOR_OFF));
  const last = evenIndex.length - 1;
  if (settle <= 0 || last < 2) return false;

  // The surface in glass units — 0 at the floor, 1 at the rim — because the focus threshold is a
  // property of the wave's shape and not of how many pixels tall this particular tile is.
  const level = (k: number): number => {
    const i = evenIndex[k] ?? 0;
    return (height - ((points[i * 2 + 1] ?? 0) + (hook[i] ?? 0))) / height;
  };

  for (let k = 0; k <= last; k += 1) {
    const d2 = k === 0 || k === last ? 0 : level(k - 1) - 2 * level(k) + level(k + 1);
    const focus = clamp01(-d2 / FLOOR_FOCUS);
    const top = height - FLOOR_DEPTH * (0.45 + 0.55 * focus) * settle;
    const x = points[(evenIndex[k] ?? 0) * 2] ?? 0;
    if (k === 0) sink.moveTo(x, top);
    else sink.lineTo(x, top);
  }

  sink.lineTo(width, height);
  sink.lineTo(0, height);
  sink.closePath();
  return true;
}

/** The surface's height at an arbitrary x, interpolated between the two samples either side. */
function surfaceYAt(surface: Surface, x: number): number {
  const { points, count } = surface;
  for (let i = 1; i < count; i += 1) {
    const right = points[i * 2] ?? 0;
    if (right < x) continue;
    const left = points[(i - 1) * 2] ?? 0;
    const span = right - left;
    const t = span <= 0 ? 0 : (x - left) / span;
    return (points[(i - 1) * 2 + 1] ?? 0) * (1 - t) + (points[i * 2 + 1] ?? 0) * t;
  }
  return points[(count - 1) * 2 + 1] ?? 0;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * A value that is rebuilt only when the inputs deciding it change.
 *
 * Gradients are the reason this exists: a hundred tiles at sixty frames a second is six thousand
 * gradient objects a second, each one re-tessellated, for a gradient that changes when the level,
 * the size, the theme or the area colour does — which is to say, almost never.
 */
export function createCache<T>(): (key: string, build: () => T) => T {
  let last: string | null = null;
  let value: T | null = null;
  return (key, build) => {
    if (value === null || key !== last) {
      value = build();
      last = key;
    }
    return value;
  };
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
  let box = '';
  let sampler: SurfaceSampler | null = null;
  let vessel: Path2D | null = null;

  const bodyFill = createCache<CanvasGradient>();
  const nearFill = createCache<CanvasGradient>();
  const farFill = createCache<CanvasGradient>();
  const floorFill = createCache<CanvasGradient>();

  return {
    resize(nextWidth, nextHeight, dpr) {
      width = nextWidth;
      height = nextHeight;
      canvas.width = Math.max(1, Math.round(nextWidth * dpr));
      canvas.height = Math.max(1, Math.round(nextHeight * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      box = `${nextWidth}x${nextHeight}`;
      sampler = createSurfaceSampler(nextWidth, nextHeight);
      vessel = null;
    },

    draw(sample, paint) {
      if (width === 0 || height === 0 || sampler === null) return;
      ctx.clearRect(0, 0, width, height);

      // Sampled ONCE. This used to walk the sampler for every layer it drew.
      const surface = sampler.measure(sample, paint);
      if (nothingToDraw(surface)) return;

      const { depthPx } = surface;
      const strip = wallStripPx(width);
      // The liquid lives inside the glass, so it is clipped to the vessel's own bottom corners.
      // Built once per size: a `Path2D` is the one shape here that never depends on the water.
      if (vessel === null) {
        vessel = new Path2D();
        traceVessel(vessel, width, height, paint.radius);
      }

      ctx.save();
      ctx.clip(vessel);

      // --- the body ---------------------------------------------------------------------
      // Anchored to the resting level, not to the surface at the left wall: see `WaterPaint.level`.
      const rest = Math.max(0, Math.min(height, height - depthPx));
      const stops = bodyStops(depthStops(paint), depthPx);
      const body = bodyFill(
        `${box}|${paint.color}|${rest}|${stops.map((s) => s.alpha).join()}`,
        () => {
          const gradient = ctx.createLinearGradient(0, rest, 0, height);
          for (const stop of stops)
            gradient.addColorStop(stop.offset, tint(paint.color, stop.alpha));
          return gradient;
        },
      );

      ctx.beginPath();
      traceBody(ctx, surface);
      ctx.fillStyle = body;
      ctx.fill();

      // --- the two wall strips, which are what give the liquid sides ------------------------
      ctx.beginPath();
      if (traceWallStrip(ctx, surface, 'near')) {
        ctx.fillStyle = nearFill(`${box}|${paint.color}`, () =>
          edgeGradient(ctx, paint.color, 0, strip, EDGE_ALPHA_NEAR),
        );
        ctx.fill();
      }
      ctx.beginPath();
      if (traceWallStrip(ctx, surface, 'far')) {
        ctx.fillStyle = farFill(`${box}|${paint.color}`, () =>
          edgeGradient(ctx, paint.color, width, width - strip, EDGE_ALPHA_FAR),
        );
        ctx.fill();
      }

      // --- the band under the surface, which is what gives it thickness ---------------------
      ctx.beginPath();
      if (traceUnderBand(ctx, surface, underDepthPx(depthPx))) {
        ctx.fillStyle = tint(paint.color, UNDER_ALPHA);
        ctx.fill();
      }

      // --- the surface itself ---------------------------------------------------------------
      ctx.beginPath();
      traceSurface(ctx, surface.points);
      ctx.lineWidth = SURFACE_WIDTH;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = tint(paint.color, SURFACE_ALPHA);
      ctx.stroke();

      // --- light: added to what is there, never mixed with it -------------------------------
      ctx.globalCompositeOperation = 'lighter';

      ctx.beginPath();
      if (traceGlint(ctx, surface)) {
        ctx.fillStyle = `rgba(255, 255, 255, ${GLINT_ALPHA})`;
        ctx.fill();
      }

      ctx.beginPath();
      if (traceFloorLight(ctx, surface)) {
        ctx.fillStyle = floorFill(box, () => {
          const gradient = ctx.createLinearGradient(0, height - FLOOR_DEPTH, 0, height);
          gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
          gradient.addColorStop(1, `rgba(255, 255, 255, ${FLOOR_ALPHA})`);
          return gradient;
        });
        ctx.fill();
      }

      // `restore` puts the composite operation back with everything else it saved.
      ctx.restore();
    },

    destroy() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

/** A wall strip's gradient: the area colour at the wall, nothing at the band's inner edge. */
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
