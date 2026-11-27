/*
 * The numbers the light is calibrated against, measured from the model rather than estimated.
 *
 * CLAUDE.md records two thresholds in this codebase that were guessed, were wrong by a factor of
 * twenty, and drew a band of light that never moved. So this file runs the bench's own gestures
 * through the model and the painter's own geometry and records the slope of the DRAWN surface — the
 * thing the light is keyed to — frame by frame.
 *
 * `SLOSH_REPORT=1 npx vitest run src/lib/water/liquidCalibrate` prints the table quoted in
 * `liquidPaint.ts`. The tests below pin what the thresholds must DO with those slopes, as a function
 * of the thresholds, so they can be run against the obvious guess as well as the chosen values —
 * and the guess must fail them.
 */

import { describe, expect, it } from 'vitest';
import { GESTURES, handAt, type Gesture } from './gestures';
import { Motion } from './motion';
import { DropletBudget } from './spray';
import { STEP_S, Slosh, realScale } from './slosh';
import {
  SLOPE_FULL,
  SLOPE_ON,
  buildEdge,
  flatFor,
  createEdge,
  lightFor,
  type LiquidVessel,
} from './liquidPaint';

interface Frame {
  /** The slope of every facet, towards the window. */
  slopes: number[];
  /** The largest the surface stands off its level, px. */
  amplitude: number;
}

/** Run a gesture through the model and the painter's geometry, keeping every frame's slopes. */
function trace(gesture: Gesture, vessel: LiquidVessel, level: number, ms: number): Frame[] {
  const model = new Slosh({
    width: vessel.width,
    height: vessel.height,
    taper: vessel.taper,
    budget: new DropletBudget(),
  });
  model.setLevel(level, false);
  const motion = new Motion();
  const edge = createEdge();
  const frames: Frame[] = [];
  let poured = false;
  for (let t = 0; t <= ms; t += STEP_S * 1000) {
    if (gesture.pour !== undefined && !poured && t >= gesture.pour.at) {
      poured = true;
      model.setLevel(Math.min(1, level + gesture.pour.by));
    }
    const here = handAt(gesture, t);
    const { ax, ay } = motion.feed(here.x / vessel.height, -here.y / vessel.height, STEP_S);
    model.drive(ax * vessel.height, ay * vessel.height);
    model.step(STEP_S);
    const frame = model.surface();
    buildEdge(frame, vessel, false, edge);
    let amplitude = 0;
    for (let j = 0; j < frame.count; j += 1) {
      amplitude = Math.max(amplitude, Math.abs((frame.hs[j] ?? 0) - frame.depth));
    }
    frames.push({ slopes: Array.from(edge.slope.subarray(0, edge.count)), amplitude });
  }
  return frames;
}

const TILE: LiquidVessel = { width: 200, height: 90, taper: 1, radius: 18 };
/** A desktop small tile, the commonest on the board. */
const BOARD: LiquidVessel = { width: 250, height: 88, taper: 1, radius: 18 };
const GLASS: LiquidVessel = { width: 96, height: 150, taper: 0.86, radius: 14 };

function gesture(id: string): Gesture {
  const found = GESTURES.find((g) => g.id === id);
  if (found === undefined) throw new Error(`no gesture ${id}`);
  return found;
}

const frameAt = (ms: number): number => Math.round(ms / (STEP_S * 1000));
const steepest = (frame: Frame): number => Math.max(0, ...frame.slopes);
const either = (frame: Frame): number => Math.max(0, ...frame.slopes.map(Math.abs));

function median(values: readonly number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

interface Thresholds {
  on: number;
  full: number;
}

const CHOSEN: Thresholds = { on: SLOPE_ON, full: SLOPE_FULL };
/** The obvious guess: the shipped field's measured 0.06 for full, and light from any slope at all. */
const GUESS: Thresholds = { on: 0, full: 0.06 };

/** Light on the brightest facet of a frame, under some thresholds. */
const lit = (frame: Frame, t: Thresholds): number =>
  Math.max(0, ...frame.slopes.map((s) => lightFor(s, t.on, t.full)));

/** Water that has stopped moving to the eye carries no light, whatever moved it. */
function stillIsDark(t: Thresholds): boolean {
  for (const vessel of [TILE, BOARD, GLASS]) {
    for (const id of ['drag', 'flick', 'shake', 'drop', 'lift', 'pour']) {
      const frames = trace(gesture(id), vessel, id === 'pour' ? 0.34 : 0.62, 7000);
      // From the moment it is visually still and stays so.
      const from = frames.findIndex(
        (_f, i) => i > frameAt(300) && frames.slice(i).every((g) => g.amplitude < 0.3),
      );
      if (from < 0) return false;
      if (frames.slice(from).some((f) => lit(f, t) > 0)) return false;
    }
  }
  return true;
}

/**
 * A pour's light sits on the stream and moves with it: on a typical frame while it runs, a quarter
 * of the surface or less carries any light, and the brightest facet is well lit. More coverage is
 * the even band; a dim brightest facet is the light nobody sees. Both are how CLAUDE.md records this
 * going wrong.
 */
function pourLightIsLocal(t: Thresholds): boolean {
  for (const vessel of [TILE, BOARD]) {
    const frames = trace(gesture('pour'), vessel, 0.34, 1200);
    const pouring = frames.slice(frameAt(300), frameAt(1100));
    const coverage = median(
      pouring.map(
        (f) => f.slopes.filter((s) => lightFor(s, t.on, t.full) > 0.02).length / f.slopes.length,
      ),
    );
    const brightest = median(pouring.map((f) => lit(f, t)));
    if (coverage > 0.25 || brightest < 0.6) return false;
  }
  return true;
}

/** A flicked glass's facing flank is fully lit while it is being flicked. */
function flickSaturates(t: Thresholds): boolean {
  for (const vessel of [TILE, BOARD, GLASS]) {
    const frames = trace(gesture('flick'), vessel, 0.62, 400);
    if (Math.max(...frames.slice(0, frameAt(300)).map((f) => lit(f, t))) < 1) return false;
  }
  return true;
}

const report = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env?.SLOSH_REPORT;

describe('the light on the slopes, calibrated against the model', () => {
  it('prints the measured slopes when asked', () => {
    if (report === undefined) return;
    const rows: string[] = [];
    const cases = [
      ['pour', 0.34],
      ['drag', 0.62],
      ['flick', 0.62],
      ['shake', 0.62],
      ['drop', 0.62],
      ['lift', 0.62],
      ['still', 0.62],
    ] as const;
    for (const [name, vessel] of [
      ['tile 200x90', TILE],
      ['board 250x88', BOARD],
      ['glass 96x150', GLASS],
    ] as const) {
      for (const [id, level] of cases) {
        const frames = trace(gesture(id), vessel, level, 7000);
        const peakIn = (a: number, b: number): string =>
          Math.max(0, ...frames.slice(frameAt(a), frameAt(b)).map(steepest)).toFixed(3);
        const visuallyStill = frames.findIndex(
          (_f, i) => i > frameAt(300) && frames.slice(i).every((g) => g.amplitude < 0.3),
        );
        const tail = frames.slice(Math.max(0, visuallyStill)).map(either);
        rows.push(
          [
            name.padEnd(13),
            id.padEnd(6),
            `peak ${peakIn(0, 7000)}`,
            `0-300 ${peakIn(0, 300)}`,
            `300-1000 ${peakIn(300, 1000)}`,
            `1-2s ${peakIn(1000, 2000)}`,
            `typical(300-1100) ${median(frames.slice(frameAt(300), frameAt(1100)).map(steepest)).toFixed(3)}`,
            `still from ${visuallyStill < 0 ? '-' : Math.round(visuallyStill * STEP_S * 1000)} ms`,
            `tail max ${Math.max(0, ...tail).toFixed(4)}`,
          ].join('  '),
        );
      }
    }
    console.log(`\n${rows.join('\n')}`);
  });

  it('keeps water that has stopped moving to the eye dark', () => {
    expect(stillIsDark(CHOSEN)).toBe(true);
  });

  it('puts the light of a pour on the stream, rather than an even band or nothing', () => {
    expect(pourLightIsLocal(CHOSEN)).toBe(true);
  });

  it('lights the facing flank fully while a glass is being flicked', () => {
    expect(flickSaturates(CHOSEN)).toBe(true);
  });

  /*
   * The requirement from CLAUDE.md: the test that pins a threshold must fail against the value it
   * replaced. These are the same three checks, run against the obvious guess.
   */
  it('fails the obvious guess, which is how it knows it measured something', () => {
    expect(stillIsDark(GUESS)).toBe(false);
    expect(pourLightIsLocal(GUESS)).toBe(false);
  });

  it('a settled glass has no slope at all', () => {
    for (const vessel of [TILE, BOARD, GLASS]) {
      const frames = trace(gesture('flick'), vessel, 0.62, 8000);
      expect(Math.max(...frames.slice(frameAt(7000)).map(either))).toBe(0);
    }
  });
});

/*
 * THE BAND ON A CREST. Round two's top-surface band sat on the yank-down's mound as a pale cap (a
 * snow-capped hill, `r3-cap-before.png`). The band now hands over to the liquid's own colour where
 * the surface bulges up (`flatFor`). These pin what it does with the bulges this model produces —
 * and that the approved pour, whose stream digs a dimple curvier than any mound, is untouched.
 */
describe('the top-surface band, calibrated against the model', () => {
  const GLASS_8CM = { ...GLASS, metresPerPx: realScale(96) };

  /** Every frame's `flat` per point, and the unsigned-curvature version a first guess would use. */
  function bands(
    id: string,
    vessel: LiquidVessel & { metresPerPx?: number },
    level: number,
    ms: number,
  ): { flat: number[]; naive: number[] }[] {
    const g = gesture(id);
    const model = new Slosh({
      width: vessel.width,
      height: vessel.height,
      taper: vessel.taper,
      budget: new DropletBudget(),
      ...(vessel.metresPerPx === undefined ? {} : { metresPerPx: vessel.metresPerPx }),
    });
    model.setLevel(level, false);
    const motion = new Motion();
    const edge = createEdge();
    const out: { flat: number[]; naive: number[] }[] = [];
    let poured = false;
    for (let t = 0; t <= ms; t += STEP_S * 1000) {
      if (g.pour !== undefined && !poured && t >= g.pour.at) {
        poured = true;
        model.setLevel(Math.min(1, level + g.pour.by));
      }
      const here = handAt(g, t);
      const { ax, ay } = motion.feed(here.x / vessel.height, -here.y / vessel.height, STEP_S);
      model.drive(ax * vessel.height, ay * vessel.height);
      model.step(STEP_S);
      buildEdge(model.surface(), vessel, true, edge);
      const flat = Array.from(edge.flat.subarray(0, edge.count));
      // The guess: how CURVED the surface is, either way, over the same stencil.
      const naive: number[] = [];
      for (let i = 0; i < edge.count; i += 1) {
        const a = Math.max(0, i - 2);
        const b = Math.min(edge.count - 1, i + 2);
        const [xa, xi, xb] = [edge.px[a] ?? 0, edge.px[i] ?? 0, edge.px[b] ?? 0];
        const [ya, yi, yb] = [edge.py[a] ?? 0, edge.py[i] ?? 0, edge.py[b] ?? 0];
        const ok = xb - xa > 0 && xi - xa > 0 && xb - xi > 0;
        const k = ok
          ? Math.abs((2 * ((yb - yi) / (xb - xi) - (yi - ya) / (xi - xa))) / (xb - xa))
          : 0;
        naive.push(flatFor(k));
      }
      out.push({ flat, naive });
    }
    return out;
  }

  it('draws the approved pour and a drag with the band exactly as approved', () => {
    for (const vessel of [GLASS, GLASS_8CM]) {
      for (const frame of bands('pour', vessel, 0.34, 2500)) {
        expect(Math.min(...frame.flat)).toBe(1);
      }
      for (const frame of bands('drag', vessel, 0.62, 2500)) {
        expect(Math.min(...frame.flat)).toBe(1);
      }
    }
  });

  it('turns the band over the yank-down mound to liquid, not a pale cap', () => {
    for (const vessel of [GLASS, GLASS_8CM]) {
      const mound = bands('drop', vessel, 0.62, 180).slice(frameAt(110));
      const liquid = mound.filter((frame) => Math.min(...frame.flat) < 0.1).length;
      expect(liquid).toBeGreaterThanOrEqual(mound.length / 2);
    }
  });

  it('keys on the surface bulging UP: curvature either way would have changed the approved pour', () => {
    const naive = bands('pour', GLASS, 0.34, 2500);
    expect(Math.min(...naive.map((frame) => Math.min(...frame.naive)))).toBeLessThan(0.5);
  });
});
