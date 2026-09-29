/*
 * The liquid's geometry, tested through the same sink the renderers draw into.
 *
 * jsdom has no canvas and no GPU, so neither renderer can be exercised here — but nothing either
 * of them draws is theirs. Every coordinate comes from the functions below, so recording the path
 * they emit tests the picture itself rather than a mock of it.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_PX,
  GLINT_FLOOR,
  GLINT_WIDTH,
  MENISCUS_FULL,
  SURFACE_INSET,
  UNDER_DEPTH,
  bodyStops,
  createSurfaceSampler,
  glintWidth,
  nothingToDraw,
  traceBody,
  traceFloorLight,
  traceGlint,
  traceUnderBand,
  traceWallStrip,
  underDepthPx,
  type PathSink,
  type Surface,
  type WaterPaint,
} from './renderer';

const WIDTH = 240;
const HEIGHT = 100;

/** A `PathSink` that keeps what it was told, so a test can measure the shape. */
function recorder(): PathSink & { xs: number[]; ys: number[]; closed: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  return {
    xs,
    ys,
    closed: 0,
    moveTo(x: number, y: number) {
      xs.push(x);
      ys.push(y);
    },
    lineTo(x: number, y: number) {
      xs.push(x);
      ys.push(y);
    },
    quadraticCurveTo(_cx: number, _cy: number, x: number, y: number) {
      xs.push(x);
      ys.push(y);
    },
    closePath() {
      this.closed += 1;
    },
  };
}

function paint(level: number, extra: Partial<WaterPaint> = {}): WaterPaint {
  return { color: 'rgb(95, 194, 148)', level, full: level >= 1, radius: 14, ...extra };
}

/** A surface at a fixed level, optionally sloping or waved. */
function measure(level: number, shape: (at: number) => number = () => 0, full = level >= 1) {
  return createSurfaceSampler(WIDTH, HEIGHT).measure(
    (at) => level + shape(at),
    paint(level, { full }),
  );
}

/** The y the surface was given at this x, to the nearest sample. */
function yAt(surface: Surface, x: number): number {
  let best = 0;
  let distance = Infinity;
  for (let i = 0; i < surface.count; i += 1) {
    const gap = Math.abs((surface.points[i * 2] ?? 0) - x);
    if (gap < distance) {
      distance = gap;
      best = i;
    }
  }
  return surface.points[best * 2 + 1] ?? 0;
}

describe('the surface', () => {
  it('spans the glass, starting at one wall and ending at the other', () => {
    const surface = measure(0.5);
    expect(surface.points[0]).toBe(0);
    expect(surface.points[(surface.count - 1) * 2]).toBe(WIDTH);
    // Ascending, with no repeated x: a duplicated point is a degenerate curve segment.
    for (let i = 1; i < surface.count; i += 1) {
      expect(surface.points[i * 2] ?? 0).toBeGreaterThan(surface.points[(i - 1) * 2] ?? 0);
    }
  });

  it('puts the resting depth where the level says, in pixels', () => {
    expect(measure(0.4).depthPx).toBeCloseTo(40);
    expect(measure(1).depthPx).toBeCloseTo(100);
  });

  it('draws nothing at all in an empty glass', () => {
    expect(nothingToDraw(measure(0))).toBe(true);
    expect(measure(0).deepestPx).toBeLessThan(EMPTY_PX);
  });

  it('draws the first wave of a pour, though the level is still nothing', () => {
    // A pour starts from an empty glass, and the water arrives before the level does.
    const pouring = measure(0, (at) => 0.06 * Math.sin(at * Math.PI));
    expect(nothingToDraw(pouring)).toBe(false);
  });

  it('climbs both walls and is flat in the middle', () => {
    const surface = measure(0.5);
    const middle = yAt(surface, WIDTH / 2);
    // Up the wall is a SMALLER y: the hook is above the flat.
    expect(yAt(surface, 0)).toBeLessThan(middle - 1);
    expect(yAt(surface, WIDTH)).toBeLessThan(middle - 1);
    expect(yAt(surface, WIDTH / 2)).toBeCloseTo(HEIGHT / 2, 5);
  });

  it('keeps the wetting film out of the simulation, not in it', () => {
    // The hook is what `y` was lifted by, and it is zero everywhere outside the two bands.
    const surface = measure(0.5);
    expect(surface.hook[0] ?? 0).toBeGreaterThan(1);
    const middle = surface.evenIndex[Math.floor(surface.evenIndex.length / 2)] ?? 0;
    expect(surface.hook[middle]).toBe(0);
  });

  it('flattens the hook at the brim, where the rim is holding the water', () => {
    const brimming = measure(0.5, () => 0, true).hook[0] ?? 0;
    const resting = measure(0.5, () => 0, false).hook[0] ?? 0;
    expect(brimming).toBeCloseTo(resting * MENISCUS_FULL, 5);
  });

  it('keeps a full glass off the rim, so it reads as brimming and not as clipped', () => {
    const surface = measure(1);
    for (let i = 0; i < surface.count; i += 1) {
      expect(surface.points[i * 2 + 1] ?? 0).toBeGreaterThanOrEqual(0);
    }
    expect(yAt(surface, WIDTH / 2)).toBeCloseTo(SURFACE_INSET, 5);
  });

  it('has no hook to speak of in a puddle', () => {
    expect(measure(0.015).hook[0] ?? 0).toBe(0);
  });
});

describe('the body', () => {
  it('lightens the film just under the surface, and darkens with depth', () => {
    const stops = bodyStops([0.13, 0.24, 0.28], 50);
    expect(stops).toHaveLength(4);
    expect(stops[0]?.alpha ?? 0).toBeLessThan(stops[1]?.alpha ?? 0);
    expect(stops[1]?.alpha ?? 0).toBeLessThan(stops[2]?.alpha ?? 0);
    expect(stops[2]?.alpha ?? 0).toBeLessThan(stops[3]?.alpha ?? 0);
    for (let i = 1; i < stops.length; i += 1) {
      expect(stops[i]?.offset ?? 0).toBeGreaterThan(stops[i - 1]?.offset ?? 0);
    }
  });

  it('drops the middle stops in water too shallow to shade', () => {
    expect(bodyStops([0.13, 0.24, 0.28], 5)).toHaveLength(2);
  });

  it('closes on the floor, so the fill is the whole liquid', () => {
    const sink = recorder();
    const surface = measure(0.5);
    traceBody(sink, surface);
    expect(Math.max(...sink.ys)).toBe(HEIGHT);
    expect(sink.closed).toBe(1);
  });

  it('never lets the band under the surface reach the floor', () => {
    expect(underDepthPx(50)).toBe(UNDER_DEPTH);
    expect(underDepthPx(3)).toBe(2.5);
    expect(traceUnderBand(recorder(), measure(0.004), underDepthPx(0.4))).toBe(false);
  });
});

describe('the wall strips', () => {
  it('stay inside the band and reach the floor', () => {
    const near = recorder();
    expect(traceWallStrip(near, measure(0.5), 'near')).toBe(true);
    expect(Math.min(...near.xs)).toBe(0);
    expect(Math.max(...near.xs)).toBeCloseTo(WIDTH * 0.09, 5);
    expect(Math.max(...near.ys)).toBe(HEIGHT);

    const far = recorder();
    expect(traceWallStrip(far, measure(0.5), 'far')).toBe(true);
    expect(Math.max(...far.xs)).toBe(WIDTH);
    expect(Math.min(...far.xs)).toBeCloseTo(WIDTH * 0.91, 5);
  });

  it('follows the meniscus, so the liquid looks thicker where it climbs', () => {
    const sink = recorder();
    traceWallStrip(sink, measure(0.5), 'near');
    // The strip's top edge is the surface itself: highest at the wall, lowest at the inner edge.
    const atWall = sink.ys[0] ?? 0;
    const atInner = Math.max(...sink.ys.filter((y) => y < HEIGHT));
    expect(atWall).toBeLessThan(atInner);
  });
});

describe('the glint', () => {
  it('is a hairline on still water, not nothing and not a band', () => {
    const surface = measure(0.5);
    const flat = glintWidth(surface, surface.evenIndex[20] ?? 0);
    expect(flat).toBeCloseTo(GLINT_WIDTH * GLINT_FLOOR, 5);
  });

  it('lights a pour, which is the gentlest thing the water ever does', () => {
    // A pour's steepest flank measures about 0.04 px/px in this field. At the spec's estimated
    // threshold that came to a quarter of the width and read as nothing at all.
    // 0.04 px/px, expressed as the drop in level that produces it across this box.
    const poured = measure(0.5, (at) => -((0.04 * WIDTH) / HEIGHT) * at);
    expect(glintWidth(poured, poured.evenIndex[20] ?? 0)).toBeGreaterThan(GLINT_WIDTH / 2);
  });

  it('brightens the flank descending to the right, where the window is', () => {
    // Away from the walls, so the meniscus cannot be what is being measured.
    const index = 20;
    const descending = measure(0.5, (at) => -0.2 * at);
    const ascending = measure(0.5, (at) => 0.2 * at);
    const lit = glintWidth(descending, descending.evenIndex[index] ?? 0);
    const dark = glintWidth(ascending, ascending.evenIndex[index] ?? 0);

    expect(lit).toBeGreaterThan(GLINT_WIDTH * GLINT_FLOOR * 1.5);
    expect(dark).toBeCloseTo(GLINT_WIDTH * GLINT_FLOOR, 5);
  });

  it('takes its slope from the waves and not from the meniscus', () => {
    // Both walls would glint permanently otherwise, which is furniture rather than light.
    const surface = measure(0.5);
    expect(glintWidth(surface, 0)).toBeCloseTo(GLINT_WIDTH * GLINT_FLOOR, 5);
  });

  it('never spills over the rim of a full glass', () => {
    const surface = measure(1, (at) => -0.2 * at);
    const sink = recorder();
    expect(traceGlint(sink, surface)).toBe(true);
    expect(Math.min(...sink.ys)).toBeGreaterThan(0);
  });

  it('leaves a puddle alone', () => {
    expect(traceGlint(recorder(), measure(0.01))).toBe(false);
  });
});

describe('the light on the floor', () => {
  it('rises under a crest and stays low under a trough, by enough to see', () => {
    // Three waves across the glass, which is the shape a drag makes and the curvature the constant
    // is calibrated against — a single long wave is a pour, and a pour barely focuses anything.
    const surface = measure(0.5, (at) => 0.04 * Math.sin(at * Math.PI * 6));
    const sink = recorder();
    expect(traceFloorLight(sink, surface)).toBe(true);

    const under = (x: number): number => {
      let best = HEIGHT;
      let distance = Infinity;
      for (let i = 0; i < sink.xs.length; i += 1) {
        const gap = Math.abs((sink.xs[i] ?? 0) - x);
        if (gap < distance && (sink.ys[i] ?? 0) < HEIGHT) {
          distance = gap;
          best = sink.ys[i] ?? HEIGHT;
        }
      }
      return best;
    };

    // A smaller y is a taller band of light. Three and a half pixels of difference, not the
    // quarter of a pixel the spec's estimated threshold produced — it is the whole effect.
    expect(under(WIDTH / 12)).toBeLessThan(under(WIDTH / 4) - 3.5);
    expect(Math.max(...sink.ys)).toBe(HEIGHT);
  });

  it('does not light the base of a glass with barely anything in it', () => {
    expect(traceFloorLight(recorder(), measure(0.03))).toBe(false);
  });
});
