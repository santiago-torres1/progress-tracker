import { describe, expect, it } from 'vitest';

import { inclusiveDaySpan, isIsoDate, parseIsoDate } from './dates.js';

describe('parseIsoDate', () => {
  it.each(['2026-09-17', '2026-01-01', '2026-12-31', '2024-02-29', '2000-02-29'])(
    'accepts the real date %s',
    (value) => {
      expect(isIsoDate(value)).toBe(true);
    },
  );

  it.each([
    ['2026-02-30', 'a day that month does not have'],
    ['2026-13-01', 'a month that does not exist'],
    ['2026-00-10', 'month zero'],
    ['2026-09-00', 'day zero'],
    ['2025-02-29', 'the 29th of a non-leap February'],
    ['2026-9-17', 'an unpadded month'],
    ['01-09-2026', 'day-first order'],
    ['2026-09-17T00:00:00Z', 'a timestamp'],
    ['yesterday', 'a word'],
    ['', 'an empty string'],
    [' 2026-09-17', 'leading whitespace'],
  ])('rejects %s (%s)', (value) => {
    expect(isIsoDate(value)).toBe(false);
    expect(parseIsoDate(value)).toBeUndefined();
  });

  it('parses to midnight UTC, so no time zone can shift the day', () => {
    expect(parseIsoDate('2026-09-17')).toBe(Date.UTC(2026, 8, 17));
  });
});

describe('inclusiveDaySpan', () => {
  it('counts both ends', () => {
    const day = (value: string): number => parseIsoDate(value) ?? Number.NaN;

    expect(inclusiveDaySpan(day('2026-09-17'), day('2026-09-17'))).toBe(1);
    expect(inclusiveDaySpan(day('2026-09-01'), day('2026-09-30'))).toBe(30);
    expect(inclusiveDaySpan(day('2026-01-01'), day('2027-01-01'))).toBe(366);
    expect(inclusiveDaySpan(day('2026-01-01'), day('2027-01-02'))).toBe(367);
  });

  it('is unaffected by daylight saving, because both ends are UTC midnight', () => {
    const day = (value: string): number => parseIsoDate(value) ?? Number.NaN;

    // Europe/Madrid springs forward on 2026-03-29 and falls back on 2026-10-25.
    expect(inclusiveDaySpan(day('2026-03-28'), day('2026-03-30'))).toBe(3);
    expect(inclusiveDaySpan(day('2026-10-24'), day('2026-10-26'))).toBe(3);
  });
});
