import { describe, expect, it } from 'vitest';

import {
  asRows,
  readBoolean,
  readDate,
  readEnum,
  readInstant,
  readInteger,
  readNumeric,
  readOptionalNumeric,
  readOptionalString,
  readString,
  RowShapeError,
} from './row.js';

describe('readNumeric', () => {
  it.each([
    ['84.0000', 84],
    ['78.0000', 78],
    ['81.6000', 81.6],
    ['0.0000', 0],
    ['3000.0000', 3000],
    ['0.3333', 0.3333],
    ['1.0000', 1],
    ['-12.5000', -12.5],
    ['9999999999.9999', 9999999999.9999],
  ])('converts the numeric string %s to the number %s', (value, expected) => {
    expect(readNumeric({ v: value }, 'v')).toBe(expected);
  });

  it('accepts a numeric already rendered as a JSON number', () => {
    expect(readNumeric({ v: 0.8889 }, 'v')).toBe(0.8889);
  });

  it('round-trips every value the schema can hold: numeric(14,4)', () => {
    // 14 significant decimal digits fits inside a double's 15, so the conversion is exact.
    for (const value of ['1234567890.1234', '0.0001', '9999999999.9999', '-9999999999.9999']) {
      expect(readNumeric({ v: value }, 'v').toFixed(4)).toBe(Number(value).toFixed(4));
    }
  });

  it('refuses to silently lose precision on a value wider than the schema allows', () => {
    // If someone widens a column, this is the failure that says so instead of shaving digits.
    expect(() => readNumeric({ v: '123456789012345678.0001' }, 'v')).toThrow(RowShapeError);
    expect(() => readNumeric({ v: '0.12345678901234567890' }, 'v')).toThrow(RowShapeError);
  });

  it.each([['1e5'], ['not a number'], [''], ['12.'], ['NaN'], ['Infinity']])(
    'rejects %s',
    (value) => {
      expect(() => readNumeric({ v: value }, 'v')).toThrow(RowShapeError);
    },
  );

  it('rejects a null where the schema says NOT NULL, and a missing column', () => {
    expect(() => readNumeric({ v: null }, 'v')).toThrow(RowShapeError);
    expect(() => readNumeric({}, 'v')).toThrow(/missing from the row/);
  });

  it('passes null through when the column is nullable', () => {
    expect(readOptionalNumeric({ v: null }, 'v')).toBeNull();
    expect(readOptionalNumeric({ v: '0.5000' }, 'v')).toBe(0.5);
  });
});

describe('readInstant', () => {
  it('normalises a PostgREST timestamptz to a single ISO-8601 shape', () => {
    expect(readInstant({ v: '2026-09-17T07:00:00+00:00' }, 'v')).toBe('2026-09-17T07:00:00.000Z');
    expect(readInstant({ v: '2026-09-17T09:00:00+02:00' }, 'v')).toBe('2026-09-17T07:00:00.000Z');
    // PostgreSQL stores microseconds; JavaScript keeps milliseconds.
    expect(readInstant({ v: '2026-09-17T06:02:56.042272+00:00' }, 'v')).toBe(
      '2026-09-17T06:02:56.042Z',
    );
  });

  it('rejects something that is not an instant', () => {
    expect(() => readInstant({ v: 'the day before yesterday' }, 'v')).toThrow(RowShapeError);
  });
});

describe('readDate', () => {
  it('passes a plain calendar day through unchanged', () => {
    expect(readDate({ v: '2026-09-17' }, 'v')).toBe('2026-09-17');
  });

  it('rejects a timestamp where a date was expected', () => {
    expect(() => readDate({ v: '2026-09-17T00:00:00Z' }, 'v')).toThrow(RowShapeError);
  });
});

describe('the other readers', () => {
  it('narrows strings, booleans and integers, and rejects the wrong type', () => {
    expect(readString({ v: 'health' }, 'v')).toBe('health');
    expect(readOptionalString({ v: null }, 'v')).toBeNull();
    expect(readBoolean({ v: true }, 'v')).toBe(true);
    expect(readInteger({ v: 36 }, 'v')).toBe(36);

    expect(() => readString({ v: 7 }, 'v')).toThrow(RowShapeError);
    expect(() => readBoolean({ v: 'true' }, 'v')).toThrow(RowShapeError);
    expect(() => readInteger({ v: 1.5 }, 'v')).toThrow(RowShapeError);
  });

  it('keeps a closed set closed', () => {
    expect(readEnum({ v: 'habit' }, 'v', ['scheduled', 'measured', 'habit'])).toBe('habit');
    expect(() => readEnum({ v: 'milestone' }, 'v', ['scheduled', 'measured', 'habit'])).toThrow(
      /expected one of scheduled, measured, habit/,
    );
  });

  it('names the offending field so a schema drift is diagnosable from the log', () => {
    try {
      readString({ title: 7 }, 'title');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RowShapeError);
      expect((error as RowShapeError).field).toBe('title');
    }
  });
});

describe('asRows', () => {
  it('accepts an array of objects', () => {
    expect(asRows([{ id: 'a' }])).toEqual([{ id: 'a' }]);
    expect(asRows([])).toEqual([]);
  });

  it('rejects anything else PostgREST might return', () => {
    expect(() => asRows(null)).toThrow(RowShapeError);
    expect(() => asRows({ id: 'a' })).toThrow(RowShapeError);
    expect(() => asRows(['a'])).toThrow(RowShapeError);
  });
});
