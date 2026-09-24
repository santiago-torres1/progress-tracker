import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS, UNKNOWN_PAGE_TITLE, pageTitleFor, sectionForPath } from './navigation';

/*
 * The one table three things read: the routes, the navigation column, and the page headings.
 *
 * What is worth asserting is what would go wrong quietly. A duplicate path would make two sections
 * current at once; `end: false` on the board would make it current on every page, because `/` is a
 * prefix of them all; a path that a URL with a trailing slash does not match would drop both the
 * heading and the current-page mark for anybody who typed the address by hand.
 */

describe('NAV_SECTIONS', () => {
  it('gives every section a distinct id and a distinct path', () => {
    expect(new Set(NAV_SECTIONS.map((section) => section.id)).size).toBe(NAV_SECTIONS.length);
    expect(new Set(NAV_SECTIONS.map((section) => section.path)).size).toBe(NAV_SECTIONS.length);
  });

  it('gives every section something to be called and something to head its page with', () => {
    for (const section of NAV_SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.path.startsWith('/')).toBe(true);
    }
  });

  it('matches exactly on the board alone, since / is a prefix of every other path', () => {
    const exact = NAV_SECTIONS.filter((section) => section.end);

    expect(exact.map((section) => section.path)).toEqual(['/']);
  });
});

describe('sectionForPath', () => {
  it('finds each section by its own path', () => {
    for (const section of NAV_SECTIONS) {
      expect(sectionForPath(section.path)?.id).toBe(section.id);
    }
  });

  it('treats a trailing slash as the same page', () => {
    expect(sectionForPath('/calendar/')?.id).toBe('calendar');
    expect(sectionForPath('/')?.id).toBe('board');
  });

  it('treats an empty path as the board', () => {
    expect(sectionForPath('')?.id).toBe('board');
  });

  it('knows a path it has never heard of', () => {
    expect(sectionForPath('/tasks')).toBeUndefined();
    expect(sectionForPath('/calendar/2026-09')).toBeUndefined();
  });
});

describe('pageTitleFor', () => {
  it('heads the board with a sentence, not with the word Board', () => {
    expect(pageTitleFor('/')).toBe('Your board');
  });

  it('heads a page it does not have without calling it an error', () => {
    expect(pageTitleFor('/tasks')).toBe(UNKNOWN_PAGE_TITLE);
    expect(UNKNOWN_PAGE_TITLE).not.toMatch(/error|sorry|oops|wrong/i);
  });
});
