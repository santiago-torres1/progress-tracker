import { describe, expect, it } from 'vitest';
import type { PathSink } from './path';
import { GESTURES, handAt, type Gesture } from './gestures';
import { Motion } from './motion';
import { DropletBudget } from './spray';
import { STEP_S, Slosh } from './slosh';
import {
  MENISCUS_PX,
  buildEdge,
  createEdge,
  lighten,
  traceEdge,
  type Edge,
  type LiquidVessel,
} from './liquidPaint';

/** A path sink that flattens every curve into points, so the drawn shape can be measured. */
class Flatten implements PathSink {
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  private x = 0;
  private y = 0;

  moveTo(x: number, y: number): void {
    this.lineTo(x, y);
  }

  lineTo(x: number, y: number): void {
    this.xs.push(x);
    this.ys.push(y);
    this.x = x;
    this.y = y;
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    const x0 = this.x;
    const y0 = this.y;
    for (let i = 1; i <= 24; i += 1) {
      const t = i / 24;
      const u = 1 - t;
      this.lineTo(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y);
    }
  }

  closePath(): void {
    // Measured as a closed polygon by `area`.
  }
}

/** The area under the drawn front edge, down to the floor, px². Shoelace over the flattened path. */
function drawnArea(edge: Edge, vessel: LiquidVessel): number {
  const sink = new Flatten();
  traceEdge(sink, edge, true);
  sink.lineTo(edge.rightX, vessel.height);
  sink.lineTo(edge.leftX, vessel.height);
  let twice = 0;
  const n = sink.xs.length;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    twice += (sink.xs[i] ?? 0) * (sink.ys[j] ?? 0) - (sink.xs[j] ?? 0) * (sink.ys[i] ?? 0);
  }
  return Math.abs(twice) / 2;
}

function gesture(id: string): Gesture {
  const found = GESTURES.find((g) => g.id === id);
  if (found === undefined) throw new Error(`no gesture ${id}`);
  return found;
}

const report = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env?.SLOSH_REPORT;

describe('the drawn water is the water there is', () => {
  /*
   * The area under the edge as DRAWN — sharpened crests, the second-order lift that pays for them,
   * both menisci and the water they take from the middle, the curves through the samples — plus the
   * water in the air and up the walls, divided by the width, against the level. The tolerance is stated in px of level: an error you would
   * need a ruler held to the screen to see, on every frame of every gesture.
   */
  const TOLERANCE_PX = 0.1;

  it('draws level × width, to within a tenth of a pixel of level, through every gesture', () => {
    let worst = 0;
    let worstAt = '';
    for (const vessel of [
      { width: 200, height: 90, taper: 1, radius: 18 },
      { width: 250, height: 88, taper: 1, radius: 18 },
      { width: 516, height: 192, taper: 1, radius: 18 },
    ]) {
      for (const level of [0.1, 0.34, 0.62, 0.9]) {
        for (const id of ['still', 'drag', 'flick', 'shake', 'drop', 'lift']) {
          const model = new Slosh({
            width: vessel.width,
            height: vessel.height,
            budget: new DropletBudget(),
          });
          model.setLevel(level, false);
          const motion = new Motion();
          const edge = createEdge();
          const g = gesture(id);
          for (let t = 0; t <= 1500; t += STEP_S * 1000) {
            const here = handAt(g, t);
            const { ax, ay } = motion.feed(here.x / vessel.height, -here.y / vessel.height, STEP_S);
            model.drive(ax * vessel.height, ay * vessel.height);
            model.step(STEP_S);
            const frame = model.surface();
            buildEdge(frame, vessel, false, edge);
            // The drawn body plus what is in the air is the level.
            const error =
              (drawnArea(edge, vessel) + model.aside) / frame.waterline - level * vessel.height;
            if (Math.abs(error) > Math.abs(worst)) {
              worst = error;
              worstAt = `${vessel.width}x${vessel.height} ${id} at ${Math.round(level * 100)}%, ${Math.round(t)} ms`;
            }
          }
        }
      }
    }
    if (report !== undefined)
      console.log(`worst drawn-level error ${worst.toFixed(3)} px (${worstAt})`);
    expect(Math.abs(worst)).toBeLessThan(TOLERANCE_PX);
  });

  it('pays for the meniscus out of the middle, rather than drawing it on top', () => {
    const vessel = { width: 200, height: 90, taper: 1, radius: 18 };
    const model = new Slosh({ width: 200, height: 90 });
    model.setLevel(0.5, false);
    const edge = buildEdge(model.surface(), vessel, false, createEdge());
    // The flat middle sits below the level by exactly the menisci's area over the width...
    expect(edge.py[Math.floor(edge.count / 2)] ?? 0).toBeGreaterThan(45);
    // ...and the drawn area is the level, to floating-point dust and the curves' flattening.
    expect(Math.abs(drawnArea(edge, vessel) / 200 - 45)).toBeLessThan(0.02);
  });
});

describe('the meniscus', () => {
  it('climbs the same 3 CSS px on a small tile and a large one: surface tension, not proportion', () => {
    for (const [w, h] of [
      [120, 80],
      [250, 88],
      [516, 296],
    ] as const) {
      const model = new Slosh({ width: w, height: h });
      model.setLevel(0.5, false);
      const edge = buildEdge(
        model.surface(),
        { width: w, height: h, taper: 1, radius: 18 },
        false,
        createEdge(),
      );
      expect(edge.climb).toBeCloseTo(MENISCUS_PX, 6);
      expect(edge.reach).toBeLessThanOrEqual(6);
    }
  });

  it('has nothing to climb with in a glass that is all but empty', () => {
    const model = new Slosh({ width: 200, height: 90 });
    model.setLevel(0.01, false);
    const edge = buildEdge(
      model.surface(),
      { width: 200, height: 90, taper: 1, radius: 18 },
      false,
      createEdge(),
    );
    expect(edge.climb).toBe(0);
  });
});

describe('colour', () => {
  /** Hue in degrees, from an `rgb()`/`rgba()` string. */
  function hue(color: string): number {
    const [r, g, b] = (color.match(/\d+(\.\d+)?/g) ?? []).map(Number).map((c) => c / 255);
    const red = r ?? 0;
    const green = g ?? 0;
    const blue = b ?? 0;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    if (max === min) return 0;
    const d = max - min;
    const h =
      max === red
        ? ((green - blue) / d) % 6
        : max === green
          ? (blue - red) / d + 2
          : (red - green) / d + 4;
    return (h * 60 + 360) % 360;
  }

  it('lightens towards white and keeps the area hue: no second colour, no blue', () => {
    for (const area of [
      'rgb(224, 180, 92)',
      'rgb(46, 125, 87)',
      'rgb(240, 147, 180)',
      'rgb(79, 82, 199)',
    ]) {
      for (const mix of [0.35, 0.6]) {
        // Rounding to whole channels moves a hue by a degree at most.
        expect(Math.abs(hue(lighten(area, mix, 1)) - hue(area))).toBeLessThan(1.5);
      }
    }
  });
});
