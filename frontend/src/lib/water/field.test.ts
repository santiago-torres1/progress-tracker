import { describe, expect, it } from 'vitest';
import { WaterField } from './field';

/** Advance by whole frames, the way the renderer will. */
function frames(field: WaterField, count: number): void {
  for (let i = 0; i < count; i += 1) field.advance(1000 / 60);
}

describe('WaterField', () => {
  it('starts flat and stays flat when nothing touches it', () => {
    const field = new WaterField();
    field.setLevel(0.5, false);
    frames(field, 120);

    expect(field.isMoving()).toBe(false);
    expect(field.heightAt(0.5)).toBeCloseTo(0.5, 6);
  });

  /*
   * Measured as a ratio against the middle rather than as a bare number, because displacing water
   * moves the whole surface a little at once (it is incompressible — see `splash`). What says a
   * WAVE is travelling, rather than the level merely shifting, is the far wall catching up with
   * the middle over time.
   */
  it('carries a disturbance away from where it landed', () => {
    const field = new WaterField({ columns: 64 });
    field.setLevel(0.5, false);
    field.splash(0.5, 0.005, 0.12);

    const far = () => Math.abs(field.surface()[2] ?? 0);
    const middle = () => Math.abs(field.surface()[32] ?? 0);

    field.advance(1000 / 60);
    const ratioAtStart = far() / middle();

    frames(field, 24);
    const ratioLater = far() / middle();

    expect(ratioAtStart).toBeLessThan(0.15);
    expect(ratioLater).toBeGreaterThan(ratioAtStart * 3);
  });

  it('settles: energy only decays, and the surface goes quiet', () => {
    const field = new WaterField();
    field.setLevel(0.6, false);
    field.splash(0.35, 0.005);

    frames(field, 10);
    const early = field.energy();
    frames(field, 60);
    const later = field.energy();

    expect(later).toBeLessThan(early);

    frames(field, 900);
    expect(field.isMoving()).toBe(false);
    expect(field.heightAt(0.2)).toBeCloseTo(0.6, 4);
  });

  /*
   * The invariant from the top of field.ts. If propagation ever gains or loses water, a glass
   * drifts off its own number while nobody is touching it — which would be the app lying about
   * somebody's progress, quietly, over minutes.
   */
  it('moves water without making or destroying any', () => {
    const field = new WaterField();
    field.setLevel(0.5, false);
    field.splash(0.2, 0.005, 0.3);
    field.splash(0.8, -0.003, 0.2);

    const before = field.mean();
    frames(field, 300);

    expect(field.mean()).toBeCloseTo(before, 5);
  });

  it('tilts away from the acceleration, and tips no water out', () => {
    const field = new WaterField();
    field.setLevel(0.5, false);
    const before = field.mean();

    // Dragged to the right: the water piles up on the left, because the glass moved first.
    field.tilt(1);
    field.advance(1000 / 60);

    expect(field.heightAt(0)).toBeGreaterThan(field.heightAt(1));
    expect(field.mean()).toBeCloseTo(before, 5);
  });

  it('heaves when the level is poured, and does not when it is merely stated', () => {
    const poured = new WaterField();
    poured.setLevel(0.2, false);
    poured.setLevel(0.6);
    poured.advance(1000 / 60);

    const stated = new WaterField();
    stated.setLevel(0.2, false);
    stated.setLevel(0.6, false);
    stated.advance(1000 / 60);

    expect(poured.isMoving()).toBe(true);
    expect(stated.isMoving()).toBe(false);
    // Either way the glass holds the same amount: a pour is a performance, not a different number.
    expect(poured.level).toBe(0.6);
    expect(stated.level).toBe(0.6);
  });

  it('undoing looks like the pour running backwards', () => {
    const field = new WaterField();
    field.setLevel(0.6, false);
    field.setLevel(0.3);
    field.advance(1000 / 60);

    // A fall drags the surface down where the water left, rather than heaving it up.
    expect(field.heightAt(0.5)).toBeLessThan(0.3);
  });

  /*
   * The test that says "water" rather than "jelly".
   *
   * The first version of this tipped the whole surface as one rigid sheet and sprang it back, and
   * the owner's description of the result was exact: gelatin, bouncy. A tilting plank has a
   * STRAIGHT surface — every point on it sits on the line joining its two ends. Water does not:
   * the far wall is still where it was while the near one has already risen, so the surface bends.
   *
   * So the measurement is deviation from that line, as a fraction of the lean itself. It is zero
   * for anything rigid however violently it rocks, and cannot be satisfied by simply making the
   * motion bigger.
   */
  it('bends across the glass instead of tilting like a plank', () => {
    const field = new WaterField();
    field.setLevel(0.5, false);

    // A drag: several frames of movement in the same direction, as the driver reports it.
    for (let i = 0; i < 5; i += 1) {
      field.tilt(14);
      field.advance(1000 / 60);
    }

    const readings = Array.from({ length: 21 }, (_, i) => field.heightAt(i / 20));
    const first = readings[0] ?? 0;
    const last = readings[20] ?? 0;
    const lean = Math.abs(first - last);
    expect(lean).toBeGreaterThan(0.01);

    let bend = 0;
    for (let i = 0; i <= 20; i += 1) {
      const straight = first + ((last - first) * i) / 20;
      bend = Math.max(bend, Math.abs((readings[i] ?? 0) - straight));
    }

    expect(bend / lean).toBeGreaterThan(0.15);
  });

  it('piles against the wall it is dragged away from, then comes back', () => {
    const field = new WaterField();
    field.setLevel(0.5, false);

    // Moving right: the glass sets off and the water does not, so it heaps on the left.
    for (let i = 0; i < 5; i += 1) {
      field.tilt(14);
      field.advance(1000 / 60);
    }
    const lean = field.heightAt(0) - field.heightAt(1);
    expect(lean).toBeGreaterThan(0);

    // Let go. It should cross over — the slosh coming back the other way, not just sagging flat.
    let crossed = false;
    for (let i = 0; i < 180 && !crossed; i += 1) {
      field.advance(1000 / 60);
      if (field.heightAt(0) - field.heightAt(1) < -lean * 0.2) crossed = true;
    }
    expect(crossed).toBe(true);
  });

  it('stays bounded and finite when shoved absurdly hard', () => {
    const field = new WaterField();
    field.setLevel(0.5, false);
    for (let i = 0; i < 50; i += 1) field.splash(Math.random(), 5, 0.5);

    frames(field, 120);

    for (const h of field.surface()) {
      expect(Number.isFinite(h)).toBe(true);
      expect(Math.abs(h)).toBeLessThanOrEqual(0.1);
    }
  });

  it('does not replay a backgrounded tab', () => {
    const slow = new WaterField();
    slow.setLevel(0.5, false);
    slow.splash(0.5, 0.005);
    slow.advance(60_000);

    const fast = new WaterField();
    fast.setLevel(0.5, false);
    fast.splash(0.5, 0.005);
    frames(fast, 6);

    // Six steps is the cap, so a minute away and six frames land in the same place.
    expect(slow.energy()).toBeCloseTo(fast.energy(), 6);
  });

  it('can be put back to still on demand, for anyone who asked for less motion', () => {
    const field = new WaterField();
    field.setLevel(0.45, false);
    field.splash(0.5, 0.005);
    frames(field, 5);
    expect(field.isMoving()).toBe(true);

    field.still();

    expect(field.isMoving()).toBe(false);
    expect(field.heightAt(0.5)).toBe(0.45);
  });

  it('reads a level between columns rather than stepping between them', () => {
    const field = new WaterField({ columns: 16 });
    field.setLevel(0.5, false);
    field.splash(0, 0.005, 0.1);
    field.advance(1000 / 60);

    const a = field.heightAt(0.02);
    const b = field.heightAt(0.05);
    expect(a).not.toBe(b);
  });
});
