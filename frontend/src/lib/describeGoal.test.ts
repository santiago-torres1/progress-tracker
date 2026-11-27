import { describe, expect, it } from 'vitest';
import { goalById } from '../test/fixtures';
import { describeGoal } from './describeGoal';

describe('describeGoal', () => {
  it('never repeats a habit’s count in the foot, at any size', () => {
    for (const id of ['goal-run', 'goal-pages']) {
      for (const size of ['small', 'medium', 'large'] as const) {
        const detail = describeGoal({ ...goalById(id), size });
        // The count opens the value line, and that is the only place it is said.
        expect(detail.valueLine).toMatch(/^\d+ of \d+ this week/);
        expect(detail.measure).toBeNull();
      }
    }
  });

  it('keeps a habit’s encouragement and its minimum', () => {
    const detail = describeGoal(goalById('goal-run'));
    expect(detail.valueLine).toBe('2 of 4 this week · minimum is 1');
    expect(detail.stateText).toBe('Past the minimum this week');
    expect(detail.level).toBe(50);
    expect(detail.minimumLevel).toBe(25);
    expect(detail.keptAlive).toBe(true);
  });

  it('gives a scheduled goal with a target its percentage', () => {
    const detail = describeGoal(goalById('goal-spanish'));
    expect(detail.valueLine).toBe('9 of 12 sessions');
    expect(detail.measure).toBe('75%');
    expect(detail.level).toBe(75);
  });

  it('gives an open-ended goal its count and no percentage', () => {
    const detail = describeGoal(goalById('goal-friends'));
    expect(detail.valueLine).toBe('3 done · 2 planned');
    expect(detail.measure).toBeNull();
    expect(detail.level).toBe(0);
  });

  it('marks where a measured goal used to be, with one quiet line', () => {
    const detail = describeGoal(goalById('goal-bike'));
    expect(detail.measure).toBe('60%');
    expect(detail.level).toBe(60);
    expect(detail.previousLevel).toBe(63.3);
    expect(detail.driftText).toMatch(/^a little lower than it was on /);
  });
});
