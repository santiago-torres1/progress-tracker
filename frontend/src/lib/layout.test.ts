/*
 * The arithmetic behind a drag, with no DOM anywhere near it.
 *
 * The thing worth protecting here is `layoutDiff`: it is what turns a gesture that crossed five
 * positions into one request. The write quota is sixty a minute, and a board that sent one PATCH
 * per tile would spend a visitor's whole allowance on a single rearrangement.
 */

import { describe, expect, it } from 'vitest';
import { layoutDiff, moveTile, positionMessage, resizeTile } from './layout';
import { goalsPayload } from '../test/fixtures';
import type { GoalSummary } from '../types/api';

const board: readonly GoalSummary[] = goalsPayload().goals;

function ids(goals: readonly GoalSummary[]): string[] {
  return goals.map((goal) => goal.id);
}

describe('moveTile', () => {
  it('moves a tile forward and closes the gap behind it', () => {
    const moved = moveTile(board, 0, 2);

    expect(ids(moved)).toEqual([
      'goal-pages',
      'goal-bike',
      'goal-run',
      'goal-spanish',
      'goal-friends',
    ]);
  });

  it('moves a tile backward', () => {
    expect(ids(moveTile(board, 3, 1))[1]).toBe('goal-spanish');
  });

  it('renumbers so the order is deterministic afterwards', () => {
    const moved = moveTile(board, 0, 2);

    expect(moved.map((goal) => goal.sortOrder)).toEqual([10, 20, 30, 40, 50]);
  });

  it('does nothing at either end rather than throwing', () => {
    expect(moveTile(board, 0, -1)).toBe(board);
    expect(moveTile(board, 4, 5)).toBe(board);
    expect(moveTile(board, 2, 2)).toBe(board);
  });
});

describe('resizeTile', () => {
  it('steps one size at a time', () => {
    expect(resizeTile(board, 0, -1)[0]?.size).toBe('medium');
    expect(resizeTile(board, 1, 1)[1]?.size).toBe('large');
  });

  it('stops at the ends without complaining', () => {
    // goal-run is already large; goal-friends is already small.
    expect(resizeTile(board, 0, 1)).toBe(board);
    expect(resizeTile(board, 4, -1)).toBe(board);
  });
});

describe('layoutDiff', () => {
  it('sends only the tiles a gesture actually moved', () => {
    const changes = layoutDiff(board, moveTile(board, 0, 2));

    // Three tiles swapped places; the two beyond them did not move.
    expect(changes.map((tile) => tile.id).sort()).toEqual(['goal-bike', 'goal-pages', 'goal-run']);
    expect(changes.every((tile) => tile.sortOrder !== undefined)).toBe(true);
  });

  it('sends nothing when a gesture ends where it started', () => {
    expect(layoutDiff(board, moveTile(moveTile(board, 0, 1), 1, 0))).toEqual([]);
    expect(layoutDiff(board, board)).toEqual([]);
  });

  it('carries a size on its own, with no sortOrder to go with it', () => {
    expect(layoutDiff(board, resizeTile(board, 1, 1))).toEqual([
      { id: 'goal-pages', size: 'large' },
    ]);
  });

  it('folds a move and a resize in the same gesture into one entry per tile', () => {
    const after = resizeTile(moveTile(board, 0, 2), 2, -1);
    const changes = layoutDiff(board, after);
    const run = changes.find((tile) => tile.id === 'goal-run');

    expect(changes.filter((tile) => tile.id === 'goal-run')).toHaveLength(1);
    expect(run).toEqual({ id: 'goal-run', sortOrder: 30, size: 'medium' });
  });

  it('ignores a tile that was not on the board before', () => {
    const extra = board[0];
    if (extra === undefined) throw new Error('fixture board is empty');

    expect(layoutDiff([], [{ ...extra, sortOrder: 999 }])).toEqual([]);
  });
});

describe('positionMessage', () => {
  it('says where a tile is in words a screen reader can read out', () => {
    expect(positionMessage('Morning pages', 1, 5, 'medium')).toBe(
      'Morning pages, position 2 of 5, medium.',
    );
  });
});
