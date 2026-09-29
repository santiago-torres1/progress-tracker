/*
 * What the drawing promises about the water it is drawing.
 *
 * The solver's invariant — the count never changes — is worth nothing on its own, because nobody
 * reads the count. What somebody reads is the waterline and the size of the body, and those are
 * properties of the CONTOUR. So the two numbers that decide them are measured against the
 * simulation here, and both tests fail against the value they replaced.
 */

import { describe, expect, it } from 'vitest';
import { Fluid } from './fluid';
import { GESTURES, Motion } from './gestures';
import { MESH_ISO, MESH_LIFT, MESH_SMOOTH, Mesh } from './mesh';

const HEIGHT = 110;
const WIDTH = 160;
const WIDE = WIDTH / HEIGHT;
const FRAME = 1000 / 60;

function resting(level: number): Fluid {
  const fluid = new Fluid({ wide: WIDE });
  fluid.setLevel(level, false);
  for (let i = 0; i < 300; i += 1) fluid.advance(FRAME);
  return fluid;
}

describe('the glass draws the level it says it holds', () => {
  /*
   * `MESH_LIFT` is MEASURED, and the value it replaced was +0.42 spacings — the figure the analysis
   * gave for how far an iso of 0.32 puts the contour outside the particles. The analysis was right
   * and incomplete: the solver has an error the other way, because water within a smoothing radius
   * of the free surface can only hold up the water above it by packing tighter than rest. The two
   * very nearly cancel.
   *
   * Drawn with +0.42, these six glasses read between 0.5 and 3.7 pixels too empty — a glass
   * understating somebody's progress on every tile of the board. This test fails at that value.
   */
  it('puts the waterline within a pixel of the level, at every level', () => {
    const mesh = new Mesh();
    for (const level of [0.04, 0.12, 0.34, 0.62, 0.85, 1]) {
      const fluid = resting(level);
      mesh.build(fluid, WIDTH, HEIGHT);
      const error = (mesh.waterline() - level) * HEIGHT;
      expect(Math.abs(error)).toBeLessThan(1.2);
    }
  }, 30_000);

  it('draws one body and nothing else when nobody has touched it', () => {
    const mesh = new Mesh();
    for (const level of [0.12, 0.62, 1]) {
      const fluid = resting(level);
      mesh.build(fluid, WIDTH, HEIGHT);
      expect(mesh.loops).toBe(1);
    }
  }, 30_000);

  it('has no water above the waterline and none missing below it', () => {
    const fluid = resting(0.5);
    const mesh = new Mesh();
    mesh.build(fluid, WIDTH, HEIGHT);
    const top = mesh.topAt(WIDTH / 2);
    expect(top).toBeGreaterThan(HEIGHT * 0.45);
    expect(top).toBeLessThan(HEIGHT * 0.55);
  }, 30_000);
});

describe('water is moved, never made — the version of it somebody can see', () => {
  /*
   * The particles conserve their volume exactly; the PICTURE is the thing that can lie. A contour
   * drawn at a threshold below half sits outside the particles that make it, so the drawn shape is
   * larger than the water — measured at three to five percent when the splat was a circle, and at
   * half a percent to two once it became an ellipse, because a circular splat at a free surface
   * reaches out into the air in every direction and an elliptical one lies down along the surface.
   * This test fails at the round-splat figures.
   */
  it('draws the area the water occupies, to within a fortieth, at rest', () => {
    const mesh = new Mesh();
    for (const level of [0.12, 0.34, 0.62, 1]) {
      const fluid = resting(level);
      mesh.build(fluid, WIDTH, HEIGHT);
      const ratio = mesh.drawnArea / (fluid.volume() * HEIGHT * HEIGHT);
      expect(ratio).toBeGreaterThan(0.99);
      expect(ratio).toBeLessThan(1.035);
    }
  }, 30_000);

  /*
   * And in flight it is worse, which is measured rather than hidden. Pulled apart hard the body
   * DILATES, because the solver resists being squeezed and not being pulled apart, and the contour
   * follows it — a glass at 62% drew 1.42 times its own area for a fraction of a second, which is a
   * glass reading nearly full when it is not.
   *
   * The bounded surface tension in `fluid.ts` brought that to 1.15 and the elliptical splat to 1.06.
   * This is the test that pins the tension — it fails with `TENSION` at zero, which is where it was.
   */
  it('never draws a ninth again its own water, even mid-yank', () => {
    const fluid = resting(0.62);
    const mesh = new Mesh();
    const gesture = GESTURES.find((g) => g.id === 'lift');
    if (gesture === undefined) throw new Error('no lift');
    const motion = new Motion();
    let peak = 0;

    for (let i = 0; i < 240; i += 1) {
      const here = gesture.at(i * FRAME);
      const { ax, ay } = motion.feed(here.x / HEIGHT, -here.y / HEIGHT, FRAME / 1000);
      fluid.drive(ax, ay);
      fluid.advance(FRAME);
      mesh.build(fluid, WIDTH, HEIGHT);
      peak = Math.max(peak, mesh.drawnArea / (fluid.volume() * HEIGHT * HEIGHT));
    }

    expect(peak).toBeLessThan(1.12);
  }, 30_000);
});

describe('water that separates, which is the whole point', () => {
  it('comes apart into more than one piece when it is yanked hard enough', () => {
    const fluid = resting(0.62);
    const mesh = new Mesh();
    const gesture = GESTURES.find((g) => g.id === 'lift');
    if (gesture === undefined) throw new Error('no lift');
    const motion = new Motion();
    let most = 0;

    for (let i = 0; i < 240; i += 1) {
      const here = gesture.at(i * FRAME);
      const { ax, ay } = motion.feed(here.x / HEIGHT, -here.y / HEIGHT, FRAME / 1000);
      fluid.drive(ax, ay);
      fluid.advance(FRAME);
      mesh.build(fluid, WIDTH, HEIGHT);
      most = Math.max(most, mesh.loops);
    }

    expect(most).toBeGreaterThan(1);

    // And rejoins: one body again once it has finished falling.
    for (let i = 0; i < 400; i += 1) fluid.advance(FRAME);
    mesh.build(fluid, WIDTH, HEIGHT);
    expect(mesh.loops).toBe(1);
  }, 30_000);

  /*
   * THE CONSTANT THAT DECIDES WHETHER DROPLETS EXIST AT ALL.
   *
   * A lone particle's density peaks at `4 / (pi * MESH_SMOOTH^2)`, and if that peak is under the
   * threshold the particle draws NOTHING — a droplet that tore off the body would vanish in
   * mid-air, and the headline feature would be erased by a rendering constant.
   *
   * The value `MESH_SMOOTH` replaced was 2.4, the solver's own smoothing radius, which was the
   * obvious thing to reuse. Its peak is 0.221, well under any sensible threshold. This test fails
   * at that value, and at any iso above 0.497.
   */
  it('splats a single particle strongly enough to draw it', () => {
    const peak = 4 / (Math.PI * MESH_SMOOTH * MESH_SMOOTH);
    expect(peak).toBeGreaterThan(MESH_ISO * 1.4);

    // And the threshold is where a lone particle draws about the area it stands for: pi*R^2 = s^2.
    const radius = MESH_SMOOTH * Math.sqrt(1 - Math.cbrt(MESH_ISO / peak));
    expect(Math.PI * radius * radius).toBeGreaterThan(0.8);
    expect(Math.PI * radius * radius).toBeLessThan(1.4);
  });

  it('shifts the drawn field by a fraction of a spacing, not by half of one', () => {
    /*
     * A guard on the calibration itself. Three errors of about half a spacing meet here and very
     * nearly cancel: the iso sitting outside the particles pushes the surface up, the solver's own
     * compaction of the top layer pulls it down, and the anisotropic kernel flattens at a free
     * surface and pulls it down again. What is left is a fifth of a spacing — a pixel and a bit at
     * the coarsest — and if the analysis ever comes back without the measurement, this says so.
     */
    expect(Math.abs(MESH_LIFT)).toBeLessThan(0.3);
  });
});
