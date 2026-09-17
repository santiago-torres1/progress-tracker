import { describe, expect, it } from 'vitest';
import { ENTRIES, goalsPayload } from '../test/fixtures';
import type { GoalSummary } from '../types/api';
import { dashboardHeadline, failureCopy, weekCopy } from './copy';

const BOARD = goalsPayload().goals;

/** The same goal at a different fill, for the bucket boundaries. */
function filled(fraction: number | null): GoalSummary {
  const first = BOARD[0];
  if (first === undefined) throw new Error('empty fixture board');
  return { ...first, progress: { ...first.progress, fraction } };
}

describe('dashboardHeadline', () => {
  it('says how full the glasses are, on the real numbers', () => {
    // 0.5, 0, 0.6, 0.75 and one null: the average of the four that have a denominator is 0.4625.
    expect(dashboardHeadline(BOARD).title).toBe('Your glass is half full.');
  });

  it('counts the goals and the areas they cover', () => {
    expect(dashboardHeadline(BOARD).detail).toBe('5 goals across 5 areas.');
  });

  it('leaves a null fraction out of the average instead of reading it as zero', () => {
    const half = dashboardHeadline([filled(0.5), filled(null)]).title;
    const quarter = dashboardHeadline([filled(0.5), filled(0)]).title;

    expect(half).toBe('Your glass is half full.');
    expect(quarter).not.toBe(half);
  });

  it('has something calm to say when nothing has a denominator yet', () => {
    expect(dashboardHeadline([filled(null), filled(null)]).title).toBe(
      'Everything here is under way.',
    );
  });

  it('does not call an empty glass a failure', () => {
    expect(dashboardHeadline([filled(0)]).title).toBe('Your glass is waiting for its first pour.');
  });

  it('reaches full without overshooting', () => {
    expect(dashboardHeadline([filled(1)]).title).toBe('Your glass is full.');
    expect(dashboardHeadline([filled(1.4)]).title).toBe('Your glass is full.');
    expect(dashboardHeadline([filled(0.9)]).title).toBe('Your glass is nearly full.');
  });

  it('never grades: no headline mentions being behind or missing anything', () => {
    const titles = [null, 0, 0.1, 0.3, 0.5, 0.7, 0.95, 1].map(
      (fraction) => dashboardHeadline([filled(fraction)]).title,
    );

    for (const title of titles) {
      expect(title).not.toMatch(/behind|late|miss|fail|should/i);
    }
  });

  it('describes an empty board as room', () => {
    expect(dashboardHeadline([])).toEqual({
      title: 'Nothing here yet. That is just room.',
      detail: 'No goals on the board.',
    });
  });
});

describe('weekCopy', () => {
  const week = ENTRIES.filter((entry) => entry.date >= '2026-09-14' && entry.date <= '2026-09-20');

  it('counts what is planned and what is already done', () => {
    expect(weekCopy('14 Sep – 20 Sep 2026', week)).toEqual({
      headline: undefined,
      summary: '14 Sep – 20 Sep 2026 · 8 things planned, 2 already done',
    });
  });

  it('calls an empty week clear rather than empty', () => {
    expect(weekCopy('14 Sep – 20 Sep 2026', [])).toEqual({
      headline: 'A clear week.',
      summary: '14 Sep – 20 Sep 2026 · nothing planned',
    });
  });

  it('celebrates a week where everything is done', () => {
    const done = week.filter((entry) => entry.status === 'completed');
    expect(weekCopy('14 Sep – 20 Sep 2026', done).headline).toBe(
      'Every glass on this week is filled.',
    );
  });
});

describe('failureCopy', () => {
  it('says "not configured" for a demo with no data source, not "broken"', () => {
    const copy = failureCopy({ kind: 'unavailable', reason: 'missing_env', missing: ['X'] });

    expect(copy.title).toBe('This demo is not connected to any data yet.');
    expect(copy.body).toContain('running fine');
  });

  it('says something different when the connection is the problem', () => {
    const offline = failureCopy({ kind: 'failed', reason: 'network', status: null });
    const unconfigured = failureCopy({ kind: 'unavailable', reason: 'missing_env', missing: [] });

    expect(offline.title).not.toBe(unconfigured.title);
    expect(offline.title).toBe('Cannot reach the server from here.');
  });

  it('passes a 400 message on, since the API writes it for the caller', () => {
    const copy = failureCopy({
      kind: 'rejected',
      error: 'invalid_range',
      message: 'from must be on or before to.',
    });

    expect(copy.body).toBe('from must be on or before to.');
  });

  it('blames the app rather than the reader, every time', () => {
    const copies = [
      failureCopy({ kind: 'unavailable', reason: 'missing_env', missing: [] }),
      failureCopy({ kind: 'unavailable', reason: 'invalid_config', missing: [] }),
      failureCopy({ kind: 'unavailable', reason: 'timeout', missing: [] }),
      failureCopy({ kind: 'unavailable', reason: 'upstream_error', missing: [] }),
      failureCopy({ kind: 'rejected', error: 'bad', message: null }),
      failureCopy({ kind: 'failed', reason: 'network', status: null }),
      failureCopy({ kind: 'failed', reason: 'timeout', status: null }),
      failureCopy({ kind: 'failed', reason: 'http', status: 500 }),
      failureCopy({ kind: 'failed', reason: 'malformed', status: 200 }),
    ];

    for (const copy of copies) {
      expect(copy.title).not.toBe('');
      expect(copy.body).not.toBe('');
      expect(`${copy.title} ${copy.body}`).not.toMatch(/error|invalid|failed|sorry|oops/i);
    }
  });
});
