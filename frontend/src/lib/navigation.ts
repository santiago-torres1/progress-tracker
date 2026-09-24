/*
 * The app's four sections, as data.
 *
 * One table, read by three things that must agree: the route objects, the navigation column (and
 * the drawer, which is the same column), and the heading at the top of every page. A section
 * added here appears in all three; a path changed here changes all three. There is nowhere else
 * in the frontend that spells out `/calendar`.
 *
 * `title` is the page's own `<h1>` — the thing focus moves to after a navigation, and the thing a
 * screen reader reads to say where it has arrived. It is deliberately the section's name rather
 * than a sentence: a screen's own headline changes with its data ("Your glass is half full."),
 * and a heading that moves under you is a poor landmark.
 */

export type SectionId = 'board' | 'calendar' | 'glasses' | 'profile';

/** Which of the profile's counts a section shows beside its name, if any. */
export type SectionCount = 'goalsOnBoard' | 'glassesFilled';

export interface NavSection {
  id: SectionId;
  path: string;
  /**
   * Whether the path must match exactly for this section to be the current one. Only the board
   * needs it: `/` is a prefix of every other route, so without it the board would be "current"
   * on all four.
   */
  end: boolean;
  /** What the column calls it. */
  label: string;
  /** The page's `<h1>`. Usually the label; the board's page is not called "Board". */
  title: string;
  count: SectionCount | null;
}

export const NAV_SECTIONS: readonly NavSection[] = [
  { id: 'board', path: '/', end: true, label: 'Board', title: 'Your board', count: 'goalsOnBoard' },
  {
    id: 'calendar',
    path: '/calendar',
    end: false,
    label: 'Calendar',
    title: 'Calendar',
    count: null,
  },
  {
    id: 'glasses',
    path: '/glasses',
    end: false,
    label: 'My full glasses',
    title: 'My full glasses',
    count: 'glassesFilled',
  },
  { id: 'profile', path: '/profile', end: false, label: 'Profile', title: 'Profile', count: null },
];

/** The heading for a URL that matches no section. Not an error page — just not a page. */
export const UNKNOWN_PAGE_TITLE = 'Page not found';

/**
 * `/calendar/` and `/calendar` are the same page.
 *
 * A trailing slash arrives from a hand-typed URL and from a few share sheets, and a shell that
 * decided it was on no page at all would drop the heading and the `aria-current` mark with it.
 */
function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname === '' ? '/' : pathname;
}

export function sectionForPath(pathname: string): NavSection | undefined {
  const path = normalize(pathname);
  return NAV_SECTIONS.find((section) => section.path === path);
}

export function pageTitleFor(pathname: string): string {
  return sectionForPath(pathname)?.title ?? UNKNOWN_PAGE_TITLE;
}
