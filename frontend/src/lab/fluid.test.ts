/*
 * What the particle fluid promises, in the form of things that fail when it stops promising them.
 *
 * Three of these pin numbers that were MEASURED against the simulation rather than chosen, and each
 * of those fails against the value it replaced — which is the only thing that makes a threshold
 * worth writing down. The replaced values are named in the comments.
 */

import { describe, expect, it } from 'vitest';
import { Fluid, hexPitch, latticeDensity, spacingFor } from './fluid';
import { GESTURES, Motion } from './gestures';

/** A tile-sized vessel: 158 by 112 CSS pixels is a medium goal tile. */
const WIDE = 158 / 112;
const UNIT = 112;
const FRAME = 1000 / 60;

function frames(fluid: Fluid, count: number): void {
  for (let i = 0; i < count; i += 1) fluid.advance(FRAME);
}

/** Settle a glass the way the board does before anybody touches it. */
function resting(level: number): Fluid {
  const fluid = new Fluid({ wide: WIDE });
  fluid.setLevel(level, false);
  frames(fluid, 120);
  return fluid;
}

/**
 * Play a gesture at a fluid exactly as the bench does: measure the vessel's position, difference it
 * twice, hand over the acceleration.
 */
function play(fluid: Fluid, id: string, count: number, watch?: (frame: number) => void): void {
  const gesture = GESTURES.find((g) => g.id === id);
  if (gesture === undefined) throw new Error(`no gesture ${id}`);
  const motion = new Motion();
  for (let i = 0; i < count; i += 1) {
    const here = gesture.at(i * FRAME);
    const { ax, ay } = motion.feed(here.x / UNIT, -here.y / UNIT, FRAME / 1000);
    fluid.drive(ax, ay);
    fluid.advance(FRAME);
    watch?.(i);
  }
}

describe('water is moved, never made', () => {
  /*
   * The invariant the whole model is written around, and this model's answer to the shipped field's
   * "the mean does not drift". Here it is exact rather than approximate: a particle is a parcel of
   * water, so the volume is the count, and nothing but a pour may change it.
   */
  it('keeps every particle through every gesture, however violent', () => {
    for (const id of ['fling', 'drop', 'lift', 'shake']) {
      const fluid = resting(0.62);
      const before = fluid.count;
      const volume = fluid.volume();
      play(fluid, id, 400);
      expect(fluid.count).toBe(before);
      expect(fluid.volume()).toBeCloseTo(volume, 10);
      expect(fluid.volume()).toBeCloseTo(0.62 * WIDE, 3);
    }
  }, 30_000);

  it('holds the water the glass says it holds, at every level', () => {
    for (const level of [0.04, 0.12, 0.34, 0.62, 0.85, 1]) {
      const fluid = resting(level);
      expect(fluid.volume()).toBeCloseTo(level * WIDE, 2);
    }
  });

  it('adds water only when it is poured, and then exactly as much as was poured', () => {
    const fluid = resting(0.2);
    fluid.setLevel(0.6);
    frames(fluid, 240);
    expect(fluid.level).toBe(0.6);
    expect(fluid.volume()).toBeCloseTo(0.6 * WIDE, 2);
  });
});

describe('a wave is never taller than the water it is made of', () => {
  it('leaves an empty glass completely alone', () => {
    const fluid = resting(0);
    expect(fluid.count).toBe(0);
    play(fluid, 'shake', 120);
    expect(fluid.highest()).toBe(0);
    expect(fluid.moving()).toBe(false);
  });

  /*
   * MEASURED, and the value it replaced was the shipped field's own shallow threshold of 0.09.
   * At 0.09 a glass at 5% lifted as hard as a pointer can move put its entire contents a quarter of
   * the way up the vessel — four and a half times its own depth — because a vertical shove moves the
   * whole body rather than heaping part of it, and nothing about the depth was limiting it.
   *
   * Only shallow glasses are checked, and deliberately: this is the rule that stops a nearly empty
   * glass conjuring a surface, and above about a sixth full the vessel is what bounds the picture.
   * The shipped field's own version of this rule stops biting at 0.09 for the same reason.
   */
  it('keeps a shallow glass inside twice its own depth, whatever is done to it', () => {
    for (const level of [0.02, 0.09, 0.15]) {
      for (const id of ['fling', 'drop', 'lift', 'shake']) {
        const fluid = resting(level);
        let peak = 0;
        play(fluid, id, 260, () => {
          peak = Math.max(peak, fluid.highest());
        });
        expect(peak).toBeLessThanOrEqual(2 * level + fluid.spacing);
      }
    }
  }, 60_000);
});

describe('the vertical case, which the shipped model cannot express at all', () => {
  /*
   * The owner's second complaint: "water effect doesn't work when moving glasses vertically.
   * Realistically, the acceleration would cause some of the water to stay then drop later."
   *
   * A glass yanked downwards leaves its water behind, so for a moment there is AIR UNDER THE WATER.
   * A height field measured from the floor has no way to spell that, which is why this is a new
   * model rather than a new constant.
   */
  it('leaves the water behind when the glass is yanked down, and puts it back', () => {
    const fluid = resting(0.62);
    const floorAtRest = lowest(fluid);
    let gap = 0;
    play(fluid, 'drop', 240, () => {
      gap = Math.max(gap, lowest(fluid) - floorAtRest);
    });

    // A quarter of the vessel of clear air under the body, at the height of the yank.
    expect(gap).toBeGreaterThan(0.2);
    // And back on the floor afterwards.
    frames(fluid, 300);
    expect(lowest(fluid) - floorAtRest).toBeLessThan(0.02);
  });

  it('answers a vertical gesture at all, which is the whole of the complaint', () => {
    const still = resting(0.62);
    frames(still, 60);
    const before = still.highest();

    const moved = resting(0.62);
    let peak = 0;
    play(moved, 'lift', 120, () => {
      peak = Math.max(peak, moved.highest());
    });

    expect(peak).toBeGreaterThan(before + 0.1);
  });
});

describe('it settles, because this is a calm product', () => {
  /*
   * Fifteen seconds of frames, because that is what the promise is worth: the loop in `driver.ts`
   * cancels itself when nothing is moving, so a gesture that never reports itself finished is a
   * board that redraws a hundred tiles forever. The slowest case measured is a full glass shaken as
   * hard as a pointer can shake it, which finishes at 8.6 seconds.
   */
  it('goes still after every gesture, and says so', () => {
    for (const id of ['pour', 'fling', 'drop', 'lift', 'shake']) {
      for (const level of [0.12, 1]) {
        const fluid = resting(level);
        if (id === 'pour') fluid.setLevel(Math.min(1, level + 0.3));
        play(fluid, id, 900);
        expect(fluid.moving()).toBe(false);
      }
    }
  }, 60_000);

  it('dries the wall film, so a wetted glass is not something to redraw forever', () => {
    const fluid = resting(0.62);
    play(fluid, 'shake', 60);
    let wet = 0;
    for (let k = 0; k < fluid.filmLeft.length; k += 1) {
      wet = Math.max(wet, fluid.filmLeft[k] ?? 0, fluid.filmRight[k] ?? 0);
    }
    expect(wet).toBeGreaterThan(0.1);

    frames(fluid, 400);
    let later = 0;
    for (let k = 0; k < fluid.filmLeft.length; k += 1) {
      later = Math.max(later, fluid.filmLeft[k] ?? 0, fluid.filmRight[k] ?? 0);
    }
    expect(later).toBeLessThan(0.02);
  });

  it('does not drift while nobody is touching it', () => {
    const fluid = resting(0.62);
    const early = surface(fluid);
    frames(fluid, 1200);
    expect(surface(fluid)).toBeCloseTo(early, 2);
  }, 30_000);
});

describe('the numbers the solver is built on', () => {
  it('spends its whole particle budget on any glass with water in it', () => {
    for (const level of [0.06, 0.2, 0.62, 1]) {
      const spacing = spacingFor(level, WIDE);
      const count = Math.round((level * WIDE) / (spacing * spacing));
      expect(count).toBeGreaterThan(300);
      expect(count).toBeLessThanOrEqual(420);
    }
    // And a shallow glass gets finer particles, because its water is only a few of them deep.
    expect(spacingFor(0.04, WIDE)).toBeLessThan(spacingFor(1, WIDE) / 3);
  });

  /*
   * Rest density decides whether the body slowly compacts or slowly inflates, so it is computed for
   * the packing a 2D fluid actually relaxes to. The value it replaced was the SQUARE lattice's, and
   * the difference showed up as a waterline that sank two percent of the vessel over four seconds on
   * a glass nobody had touched.
   */
  it('computes rest density for a hexagonal packing, close to one particle per spacing squared', () => {
    for (const spacing of [0.012, 0.03, 0.0588]) {
      const density = latticeDensity(spacing * 2.4, spacing);
      expect(density).toBeGreaterThan(0.97 / (spacing * spacing));
      expect(density).toBeLessThan(1.01 / (spacing * spacing));
    }
    // Hexagonal pitch is a little wider than the square one that owns the same area.
    expect(hexPitch(1)).toBeCloseTo(1.0746, 3);
  });
});

/** The lowest particle, which is where the floor of the water is. */
function lowest(fluid: Fluid): number {
  let low = 2;
  for (let i = 0; i < fluid.count; i += 1) low = Math.min(low, fluid.y[i] ?? 0);
  return low;
}

/** The mean height of the top tenth of the water: a cheap stand-in for the waterline. */
function surface(fluid: Fluid): number {
  const heights: number[] = [];
  for (let i = 0; i < fluid.count; i += 1) heights.push(fluid.y[i] ?? 0);
  heights.sort((a, b) => b - a);
  const take = Math.max(1, Math.round(heights.length / 10));
  let total = 0;
  for (let i = 0; i < take; i += 1) total += heights[i] ?? 0;
  return total / take;
}
