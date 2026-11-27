/*
 * Breakup: the water stops being one body.
 *
 * Every threshold here is a physical one — gravity, the Stokes limit, a measured run-up speed —
 * and these tests pin what each gesture actually does against them, so a change to the model that
 * starts throwing droplets on a drag, or stops throwing them on a flick, fails here first.
 * `SLOSH_REPORT=1` prints the measurements.
 */

import { describe, expect, it } from 'vitest';
import { GESTURES, handAt, type Gesture } from './gestures';
import { Motion } from './motion';
import {
  DEFAULT_STRENGTH,
  G_PX,
  METRES_PER_PX,
  RUNUP_M_S,
  STEP_S,
  Slosh,
  fundamentalPeriod,
  realScale,
  type SloshOptions,
} from './slosh';
import { DropletBudget, GLOBAL_DROPLETS, MAX_DROPLETS } from './spray';

const GLASS = { width: 96, height: 150, taper: 0.86 };
const VESSELS: readonly [string, Omit<SloshOptions, 'budget'>][] = [
  ['glass 0.4 mm/px', GLASS],
  ['glass as 8 cm', { ...GLASS, metresPerPx: realScale(96) }],
  ['tile 200x90', { width: 200, height: 90 }],
  ['board 250x88', { width: 250, height: 88 }],
];

function gesture(id: string): Gesture {
  const found = GESTURES.find((g) => g.id === id);
  if (found === undefined) throw new Error(`no gesture ${id}`);
  return found;
}

interface Run {
  model: Slosh;
  /** The largest of each breakup measure, as a fraction of its threshold. */
  fall: number;
  steep: number;
  runup: number;
  /** Most droplets in the air at once, and the peak swing of the body, px. */
  live: number;
  peak: number;
}

function run(
  id: string,
  options: Omit<SloshOptions, 'budget'>,
  ms: number,
  extra: Partial<SloshOptions> = {},
): Run {
  const g = gesture(id);
  const model = new Slosh({ ...options, ...extra, budget: extra.budget ?? new DropletBudget() });
  const level = id === 'pour' ? 0.34 : 0.62;
  model.setLevel(level, false);
  const motion = new Motion();
  const out: Run = { model, fall: 0, steep: 0, runup: 0, live: 0, peak: 0 };
  let poured = false;
  for (let t = 0; t <= ms; t += STEP_S * 1000) {
    if (g.pour !== undefined && !poured && t >= g.pour.at) {
      poured = true;
      model.setLevel(level + g.pour.by);
    }
    const here = handAt(g, t);
    const { ax, ay } = motion.feed(here.x / options.height, -here.y / options.height, STEP_S);
    model.drive(ax * options.height, ay * options.height);
    model.step(STEP_S);
    out.fall = Math.max(out.fall, model.measures.fall);
    out.steep = Math.max(out.steep, model.measures.steep);
    out.runup = Math.max(out.runup, model.measures.runup);
    out.live = Math.max(out.live, model.droplets.count);
    const frame = model.surface();
    for (let j = 0; j < frame.count; j += 1) {
      out.peak = Math.max(out.peak, Math.abs((frame.hs[j] ?? 0) - frame.depth));
    }
  }
  return out;
}

const report = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env?.SLOSH_REPORT;

describe('breakup: what each gesture does, measured against the thresholds', () => {
  it('prints the table when asked', () => {
    if (report === undefined) return;
    const rows: string[] = [];
    for (const [name, vessel] of VESSELS) {
      for (const id of ['drag', 'flick', 'shake', 'drop', 'lift', 'pour', 'still']) {
        const r = run(id, vessel, 6000);
        const room = vessel.height * (1 - (id === 'pour' ? 0.34 : 0.62));
        rows.push(
          [
            name.padEnd(16),
            id.padEnd(6),
            `fall ${r.fall.toFixed(2).padStart(5)}g`,
            `steep ${r.steep.toFixed(2).padStart(5)}`,
            `run-up ${(r.runup * RUNUP_M_S).toFixed(3)} m/s`,
            `thrown ${String(r.model.droplets.thrown).padStart(3)}`,
            `most at once ${String(r.live).padStart(2)}`,
            `peak ${r.peak.toFixed(1).padStart(5)} px = ${((100 * r.peak) / room).toFixed(0).padStart(3)}% of room`,
          ].join('  '),
        );
      }
    }
    console.log(`\n${rows.join('\n')}`);
  });

  it('throws nothing on a drag, in any vessel: every measure stays under its threshold', () => {
    for (const [, vessel] of VESSELS) {
      const r = run('drag', vessel, 4000);
      expect(r.model.droplets.thrown).toBe(0);
      expect(r.fall).toBeLessThan(1);
      expect(r.steep).toBeLessThan(1);
      expect(r.runup).toBeLessThan(1);
    }
  });

  it('leaves the approved pour alone: no droplets, no chop, in any vessel', () => {
    for (const [, vessel] of VESSELS) {
      const r = run('pour', vessel, 3000);
      expect(r.model.droplets.thrown).toBe(0);
      expect(r.model.cascaded).toBe(0);
    }
  });

  /*
   * In a 3.8 cm glass every wave shorter than about 4 cm is held more by surface tension than by
   * gravity, and the cascade's chop is all such waves. Counted in full, the chop reads as breaking
   * and feeds itself: a flicked glass stays "violent" for half a second longer, and even a drag —
   * which must stay calm — sets the cascade off. Counting gravity's share only, neither happens.
   */
  it('counts only the gravity share of a wave towards breaking, or the chop feeds itself', () => {
    const lastBreak = (holds: boolean): number => {
      const g = gesture('flick');
      const model = new Slosh({ ...GLASS, capillaryHolds: holds, budget: new DropletBudget() });
      model.setLevel(0.62, false);
      const motion = new Motion();
      let last = 0;
      for (let t = 0; t <= 3000; t += STEP_S * 1000) {
        const here = handAt(g, t);
        const { ax } = motion.feed(here.x / GLASS.height, 0, STEP_S);
        model.drive(ax * GLASS.height, 0);
        model.step(STEP_S);
        if (model.violence >= 1) last = t;
      }
      return last;
    };
    expect(lastBreak(true)).toBeLessThan(500);
    expect(lastBreak(false)).toBeGreaterThan(lastBreak(true) + 250);
    expect(run('drag', GLASS, 3000).model.cascaded).toBe(0);
    expect(run('drag', GLASS, 3000, { capillaryHolds: false }).model.cascaded).toBeGreaterThan(0);
  });

  it('breaks up on a flick, a shake and a slam, within the per-glass budget', () => {
    for (const [, vessel] of VESSELS) {
      for (const id of ['flick', 'shake', 'drop']) {
        const r = run(id, vessel, 3000);
        expect(r.model.droplets.thrown).toBeGreaterThanOrEqual(3);
        expect(r.live).toBeLessThanOrEqual(MAX_DROPLETS);
      }
    }
  });

  /*
   * The run-up threshold is the measured one. A drag brings the wall water up at about 0.1 m/s, so
   * a guess of 0.1 m/s — the obvious round number — would send a sheet up the wall on every
   * rearrange of the board. The flick reaches several times the chosen value.
   */
  it('puts the run-up threshold between a drag and a flick, which a round-number guess would not', () => {
    const drag = Math.max(...VESSELS.map(([, v]) => run('drag', v, 3000).runup)) * RUNUP_M_S;
    const flick = Math.min(...VESSELS.map(([, v]) => run('flick', v, 1000).runup)) * RUNUP_M_S;
    expect(drag).toBeLessThan(RUNUP_M_S * 0.75);
    expect(flick).toBeGreaterThan(RUNUP_M_S * 1.5);
    expect(drag).toBeGreaterThan(0.08);
  });
});

describe('breakup: budgets, rest and sleep', () => {
  it('shares one budget across a busy board, and degrades each glass rather than any to nothing', () => {
    const budget = new DropletBudget();
    const glasses = Array.from(
      { length: 30 },
      (_, i) => new Slosh({ ...GLASS, seed: i + 1, budget }),
    );
    for (const glass of glasses) glass.setLevel(0.62, false);
    let mostLive = 0;
    let mostInOne = 0;
    for (let f = 0; f < 240; f += 1) {
      for (const [i, glass] of glasses.entries()) {
        glass.drive(3 * G_PX * Math.sin(f * 0.6 + i), 0);
        glass.step(STEP_S);
        mostInOne = Math.max(mostInOne, glass.droplets.count);
      }
      mostLive = Math.max(mostLive, budget.live);
    }
    expect(mostLive).toBeLessThanOrEqual(GLOBAL_DROPLETS);
    expect(mostInOne).toBeLessThanOrEqual(MAX_DROPLETS);
    // Busy: a glass's share has shrunk, but is never nothing while there is room.
    budget.live = Math.round(GLOBAL_DROPLETS * 0.9);
    expect(budget.allowance(0)).toBeGreaterThan(0);
    expect(budget.allowance(0)).toBeLessThan(MAX_DROPLETS);
    for (const glass of glasses) glass.dispose();
  });

  it('costs nothing at rest: no droplets, no sampling, asleep', () => {
    const model = new Slosh({ ...GLASS, budget: new DropletBudget() });
    model.setLevel(0.62, false);
    for (let i = 0; i < 600; i += 1) model.advance(STEP_S * 1000);
    expect(model.droplets.count).toBe(0);
    expect(model.sampledSteps).toBe(0);
    expect(model.asleep).toBe(true);
  });

  it('brings every droplet home and sleeps after a flick and after a slam', () => {
    for (const id of ['flick', 'drop', 'shake']) {
      const r = run(id, GLASS, 7000);
      expect(r.model.droplets.thrown).toBeGreaterThan(0);
      expect(r.model.droplets.count).toBe(0);
      expect(r.model.aside).toBe(0);
      expect(r.model.asleep).toBe(true);
    }
  });
});

describe('the cascade: a hard event goes briefly choppy, then calm, and never gains energy', () => {
  it('only ever loses energy once the hand has stopped', () => {
    // Droplets off: their landing puts water back as a bump, which is energy coming home, not made.
    const model = new Slosh({ ...GLASS, spray: false, budget: new DropletBudget() });
    model.setLevel(0.62, false);
    const motion = new Motion();
    const g = gesture('flick');
    let previous = Infinity;
    let chopPeak = 0;
    let chopLate = 0;
    for (let t = 0; t <= 2500; t += STEP_S * 1000) {
      const here = handAt(g, t);
      const { ax } = motion.feed(here.x / GLASS.height, 0, STEP_S);
      model.drive(ax * GLASS.height, 0);
      model.step(STEP_S);
      const energy = model.energy();
      if (t > 150) {
        expect(energy).toBeLessThanOrEqual(previous * (1 + 1e-12));
      }
      previous = energy;
      const chop = model.energyIn(8, 20);
      chopPeak = Math.max(chopPeak, chop);
      if (t > 1500) chopLate = Math.max(chopLate, chop);
    }
    expect(model.cascaded).toBeGreaterThan(0);
    expect(chopPeak).toBeGreaterThan(0);
    expect(chopLate).toBeLessThan(chopPeak * 0.01);
  });
});

describe('strength and scale', () => {
  it('rocks the glass by about a fifth of the room above its water on a drag, at the default strength', () => {
    const r = run('drag', GLASS, 3000);
    const room = GLASS.height * (1 - 0.62);
    expect(r.peak / room).toBeGreaterThan(0.15);
    expect(r.peak / room).toBeLessThan(0.25);
    // And only the flick comes near the rim.
    expect(run('flick', GLASS, 3000).peak / room).toBeGreaterThan(0.5);
    expect(DEFAULT_STRENGTH).toBe(0.5);
  });

  it('makes the bench glass a real drinking glass: about 3 Hz instead of 5, and a big tile slower', () => {
    const at = (w: number, h: number, mpp: number): number => {
      const g = 9.81 / mpp;
      const cap = 7.28e-5 / mpp ** 3;
      return 1 / fundamentalPeriod(w * (0.86 + 0.14 * 0.62), 0.62 * h, g, cap);
    };
    const pixel = at(96, 150, METRES_PER_PX);
    const real = at(96, 150, realScale(96));
    expect(pixel).toBeGreaterThan(4.3);
    expect(real).toBeGreaterThan(2.6);
    expect(real).toBeLessThan(3.4);
    expect(1 / fundamentalPeriod(516, 0.62 * 192, 9.81 / realScale(516))).toBeLessThan(
      1 / fundamentalPeriod(250, 0.62 * 88, 9.81 / realScale(250)),
    );
  });

  it('leans the water the same at either scale: scale sets the pace, strength sets the push', () => {
    const lean = (metresPerPx: number): number => {
      const model = new Slosh({ ...GLASS, metresPerPx, spray: false, cascade: false });
      model.setLevel(0.62, false);
      for (let i = 0; i < 300; i += 1) {
        model.drive(0.4 * G_PX, 0);
        model.step(STEP_S);
      }
      return model.heightAt(0) - model.heightAt(1);
    };
    // To a fiftieth of a pixel: what is left is the last of the transient, ringing at two paces.
    expect(Math.abs(lean(realScale(96)) - lean(METRES_PER_PX))).toBeLessThan(0.02);
  });
});
