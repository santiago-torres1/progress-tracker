import { describe, expect, it } from 'vitest';
import {
  accountDate,
  memberSinceLine,
  savedNote,
  timeZoneChoices,
  weekStartChoices,
  weekStartLabel,
  zoneLabel,
} from './profile';

/*
 * The profile page's facts.
 *
 * Nothing below asserts an English month name or weekday: those come from the viewer's locale, and
 * a test that pinned them would only pass on the machine that wrote it. What is asserted is the
 * part that can be wrong — which DAY an instant falls on, in whose zone — and that every function
 * is total, because a profile page that throws on a zone this browser has not heard of is a profile
 * page nobody can reach.
 */

/** 23:30 UTC: already the 15th in Auckland, still the 14th in New York. */
const LATE = '2026-08-14T23:30:00.000Z';

describe('accountDate', () => {
  it('reads the day in the zone the account counts its days in', () => {
    expect(accountDate(LATE, 'Pacific/Auckland')).toContain('15');
    expect(accountDate(LATE, 'America/New_York')).toContain('14');
  });

  it('answers null for an instant it cannot read, rather than "Invalid Date"', () => {
    expect(accountDate('whenever', 'UTC')).toBeNull();
  });

  it('still gives a date for a zone this browser does not know', () => {
    expect(accountDate(LATE, 'Mars/Olympus')).not.toBeNull();
  });
});

describe('memberSinceLine', () => {
  it('says "today" on the first day rather than "0 days ago"', () => {
    const line = memberSinceLine(LATE, 'UTC', 0);
    expect(line).toContain('that is today');
    expect(line).not.toContain('0 days');
  });

  it('counts one day in the singular', () => {
    expect(memberSinceLine(LATE, 'UTC', 1)).toContain('1 day ago');
  });

  it('states the days that have passed, and nothing about them', () => {
    const line = memberSinceLine(LATE, 'UTC', 40);
    expect(line).toContain('40 days ago');
    expect(line).not.toMatch(/streak|best|record|congratulations|keep it up/i);
  });

  it('says something true when the instant cannot be read', () => {
    expect(memberSinceLine('whenever', 'UTC', 3)).toBe('Here since your first visit.');
  });

  it('never trusts a count the API could not have meant', () => {
    expect(memberSinceLine(LATE, 'UTC', Number.NaN)).toContain('that is today');
    expect(memberSinceLine(LATE, 'UTC', -5)).toContain('that is today');
  });
});

describe('zoneLabel', () => {
  it('names the zone and its current offset', () => {
    const label = zoneLabel('Europe/Madrid', new Date(LATE));
    expect(label).toContain('Europe/Madrid');
    expect(label).toContain('GMT');
  });

  it('follows the clock rather than assuming one offset all year', () => {
    const summer = zoneLabel('Europe/Madrid', new Date('2026-07-01T12:00:00.000Z'));
    const winter = zoneLabel('Europe/Madrid', new Date('2026-01-01T12:00:00.000Z'));
    expect(summer).not.toBe(winter);
  });

  it('falls back to the plain name for a zone it cannot resolve', () => {
    expect(zoneLabel('Mars/Olympus', new Date(LATE))).toBe('Mars/Olympus');
  });
});

describe('timeZoneChoices', () => {
  it('always offers the zone in use and the one this browser is in', () => {
    const choices = timeZoneChoices('Mars/Olympus', 'Pacific/Auckland');

    expect(choices).toContain('Mars/Olympus');
    expect(choices).toContain('Pacific/Auckland');
    expect(choices).toContain('UTC');
  });

  it('offers each zone once, in order', () => {
    const choices = timeZoneChoices('UTC', 'UTC');

    expect(new Set(choices).size).toBe(choices.length);
    expect([...choices].sort((a, b) => a.localeCompare(b))).toEqual(choices);
  });
});

describe('the week start', () => {
  it('offers seven days, ISO 1 to 7, with seven different names', () => {
    const choices = weekStartChoices();

    expect(choices.map((choice) => choice.value)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(choices.map((choice) => choice.label)).size).toBe(7);
  });

  it('names the day the profile holds', () => {
    const choices = weekStartChoices();

    expect(weekStartLabel(7)).toBe(choices[6]?.label);
    expect(weekStartLabel(1)).toBe(choices[0]?.label);
  });

  it('falls back to the default week start for a value the API could not have sent', () => {
    expect(weekStartLabel(0)).toBe(weekStartLabel(1));
    expect(weekStartLabel(9)).toBe(weekStartLabel(1));
  });
});

describe('savedNote', () => {
  it('says what a saved zone changed, not just that something saved', () => {
    expect(savedNote({ timeZone: 'Pacific/Auckland' })).toContain('Pacific/Auckland');
    expect(savedNote({ timeZone: 'Pacific/Auckland' })).toContain('days');
  });

  it('names the day weeks now start on', () => {
    expect(savedNote({ weekStartsOn: 7 })).toContain(weekStartLabel(7));
  });

  it('still says something for a patch with nothing in it', () => {
    expect(savedNote({})).toBe('Saved.');
  });
});
