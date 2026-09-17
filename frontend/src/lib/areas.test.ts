import { describe, expect, it } from 'vitest';
import { areasPayload, goalsPayload } from '../test/fixtures';
import { areasInUse } from './areas';

const AREAS = areasPayload().areas;
const GOALS = goalsPayload().goals;

describe('areasInUse', () => {
  it('names only the colours actually on the board, in legend order', () => {
    expect(areasInUse(AREAS, GOALS).map((area) => area.slug)).toEqual([
      'health',
      'learning',
      'money',
      'relationships',
      'creative',
    ]);
  });

  it('leaves out an area nothing uses', () => {
    expect(areasInUse(AREAS, GOALS).map((area) => area.slug)).not.toContain('work');
  });

  it('says nothing at all when no goal has an area', () => {
    const arealess = GOALS.map((goal) => ({ ...goal, area: null }));
    expect(areasInUse(AREAS, arealess)).toEqual([]);
  });
});
