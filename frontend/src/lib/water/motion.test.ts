import { describe, expect, it } from 'vitest';
import { CARRY_S, Carry, Motion } from './motion';

describe('Carry: a glass that jumps is carried there', () => {
  it('never accelerates harder than D / τ², arrives, and stops', () => {
    const carry = new Carry();
    carry.feed(0, 0, 1 / 60);
    let peak = 0;
    let velocity = 0;
    for (let i = 0; i < 120; i += 1) {
      const { ax } = carry.feed(150, 0, 1 / 60);
      peak = Math.max(peak, Math.abs(ax));
      velocity += ax / 60;
    }
    expect(peak).toBeLessThanOrEqual((150 / CARRY_S ** 2) * 1.001);
    // About one glass along a shelf pushes like the bench's drag, 0.36 g at 0.4 mm/px: 0.3–0.5 g.
    const g = (peak * 0.0004) / 9.81;
    expect(g).toBeGreaterThan(0.3);
    expect(g).toBeLessThan(0.5);
    // It set off and stopped: the accelerations add up to no speed at all.
    expect(Math.abs(velocity)).toBeLessThan(1);
    expect(carry.still).toBe(true);
  });

  it('stays stable through a long frame, as when a tab comes back', () => {
    const carry = new Carry();
    carry.feed(0, 0, 1 / 60);
    const { ax } = carry.feed(500, 0, 2);
    expect(Number.isFinite(ax)).toBe(true);
    for (let i = 0; i < 60; i += 1) carry.feed(500, 0, 1 / 60);
    expect(carry.still).toBe(true);
  });
});

describe('Motion: a smooth position, differenced twice', () => {
  it('reads a constant acceleration back', () => {
    const motion = new Motion();
    let a = 0;
    for (let i = 0; i <= 60; i += 1) {
      const t = i / 60;
      a = motion.feed(0.5 * 100 * t * t, 0, 1 / 60).ax;
    }
    expect(a).toBeCloseTo(100, 0);
  });
});
