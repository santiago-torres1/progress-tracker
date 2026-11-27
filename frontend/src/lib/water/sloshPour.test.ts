/*
 * THE POUR IS APPROVED. "I really like the pouring animation."
 *
 * These are the surface heights of the pour as the owner saw and approved it — captured from the
 * model before round two changed anything else — at six moments, eight places across, plus the
 * bubble count. Breakup, the cascade, strength and scale were all added around it; this test is
 * what proves they did not touch it. If a change here is wanted, it is a change to something the
 * owner signed off, and it needs their eyes, not a new golden.
 */

import { describe, expect, it } from 'vitest';
import { STEP_S, Slosh, realScale } from './slosh';
import { DropletBudget } from './spray';

/** Rows at 300, 500, 700, 900, 1200 and 2000 ms; columns at 0, .1, .25, .32, .4, .6, .9 and 1 across, then bubbles. */
const AT = [0, 0.1, 0.25, 0.32, 0.4, 0.6, 0.9, 1];
const ROWS = [3, 5, 7, 9, 12, 20];

const APPROVED: Record<'tile' | 'glass' | 'glass as 8 cm', number[][]> = {
  tile: [
    [32.3673, 32.3755, 31.7254, 30.9266, 31.8022, 32.047, 31.5444, 31.526, 1],
    [36.5477, 36.4333, 34.9731, 33.5681, 36.2432, 39.7316, 41.5902, 41.6746, 0],
    [46.6385, 46.4147, 44.2405, 42.3655, 44.9853, 48.2783, 49.7034, 49.7676, 2],
    [53.8474, 53.6789, 52.1194, 50.9002, 52.9094, 55.7687, 57.2693, 57.3679, 2],
    [58.3184, 58.3363, 58.2173, 58.1257, 58.0204, 57.4809, 56.6338, 56.5895, 2],
    [57.9073, 57.887, 57.7947, 57.7344, 57.6589, 57.4897, 57.3634, 57.3553, 0],
  ],
  glass: [
    [53.4809, 53.4494, 52.4606, 51.1018, 52.5445, 53.2835, 53.5178, 53.5482, 2],
    [64.1539, 64.051, 62.0079, 59.3102, 62.6026, 64.6642, 65.1024, 65.126, 2],
    [78.9367, 78.7691, 76.3799, 73.4214, 76.9901, 79.4355, 80.1831, 80.2411, 3],
    [91.4312, 91.2987, 89.6473, 87.6752, 90.101, 91.92, 92.4391, 92.4694, 5],
    [96.1712, 96.1632, 96.1094, 96.0665, 95.9521, 95.9039, 95.9508, 95.9602, 3],
    [96.1283, 96.1192, 96.0804, 96.0585, 96.0342, 95.9739, 95.8728, 95.8617, 0],
  ],
  // The chosen glass (2026-11-25: 8 cm, strength 0.5). Captured from the round-two model the owner
  // watched when choosing it — the same pour at the real scale, whose ripples run slower.
  'glass as 8 cm': [
    [54.0044, 53.8243, 52.5429, 51.1734, 52.6837, 53.5089, 52.9436, 52.9207, 2],
    [63.3415, 63.0811, 60.2186, 57.4518, 61.2989, 65.5415, 66.6534, 66.614, 2],
    [78.2698, 77.9383, 74.4928, 71.3967, 75.6571, 80.3018, 81.7525, 81.8022, 3],
    [91.3724, 91.1019, 88.4096, 86.1747, 89.1003, 92.4042, 93.4085, 93.4658, 5],
    [97.0163, 96.9476, 96.6775, 96.5413, 96.422, 95.9029, 94.8472, 94.7933, 3],
    [95.5342, 95.5754, 95.7427, 95.8314, 95.9239, 96.1226, 96.3708, 96.392, 0],
  ],
};

describe('the approved pour', () => {
  for (const [name, width, height, taper, metresPerPx] of [
    ['tile', 200, 90, 1, undefined],
    ['glass', 96, 150, 0.86, undefined],
    ['glass as 8 cm', 96, 150, 0.86, realScale(96)],
  ] as const) {
    it(`is unchanged in the ${name}: same surface, same bubbles, nothing thrown`, () => {
      const model = new Slosh({ width, height, taper, metresPerPx, budget: new DropletBudget() });
      model.setLevel(0.34, false);
      let poured = false;
      const seen: number[][] = [];
      for (let i = 0; i <= 120; i += 1) {
        if (!poured && i * STEP_S * 1000 >= 200) {
          poured = true;
          model.setLevel(0.64);
        }
        model.drive(0, 0);
        model.step(STEP_S);
        if (i % 6 === 0 && ROWS.includes(i / 6)) {
          seen.push(AT.map((u) => model.heightAt(u)).concat([model.bubbles]));
        }
      }
      const approved = APPROVED[name];
      seen.forEach((row, r) => {
        row.forEach((value, c) => {
          // The approved numbers were stored to 1e-4 px.
          expect(Math.abs(value - (approved[r]?.[c] ?? NaN))).toBeLessThan(2e-4);
        });
      });
      expect(model.droplets.thrown).toBe(0);
    });
  }
});
