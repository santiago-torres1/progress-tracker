/*
 * One realistic board and one realistic fortnight, shared by the screen tests.
 *
 * The payloads are typed as the response contract rather than as `unknown`, so a change to
 * `types/api.ts` breaks the fixtures here as well as the client that parses them.
 *
 * Every instant is built from local wall-clock parts and every entry carries the runner's own
 * time zone, so "18:30" is 18:30 on any machine. The clock is fixed at 09:30 on Thursday
 * 17 September 2026 — a Thursday in the week of 14–20 September, which is the week the design
 * mockups use.
 */

import { vi, type Mock } from 'vitest';
import type { AreasResponse, CalendarEntry, CalendarResponse, GoalsResponse } from '../types/api';

/** Thursday 17 September 2026, 09:30, local. */
export const NOW = new Date(2026, 8, 17, 9, 30);

export const TODAY_ISO = '2026-09-17';

export const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** An instant from local wall-clock parts, so a rendered time is the time written here. */
function at(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

const AREA_HEALTH = {
  id: 'area-health',
  slug: 'health',
  name: 'Health & Wellbeing',
  icon: 'heart',
};
const AREA_LEARNING = {
  id: 'area-learning',
  slug: 'learning',
  name: 'Learning & Skills',
  icon: 'book',
};
const AREA_MONEY = { id: 'area-money', slug: 'money', name: 'Money & Finances', icon: 'wallet' };
const AREA_PEOPLE = {
  id: 'area-relationships',
  slug: 'relationships',
  name: 'Relationships',
  icon: 'users',
};
const AREA_CREATIVE = {
  id: 'area-creative',
  slug: 'creative',
  name: 'Creativity & Hobbies',
  icon: 'palette',
};
const AREA_WORK = { id: 'area-work', slug: 'work', name: 'Work & Career', icon: 'briefcase' };

const TIMES = { createdAt: '2026-01-05T10:00:00.000Z', updatedAt: '2026-09-16T20:00:00.000Z' };

/**
 * Five active goals: two habits (one above its minimum, one not), a measured goal that has gone
 * backwards, a scheduled goal with a target, and an open-ended one whose fraction is null.
 */
export function goalsPayload(): GoalsResponse {
  return {
    goals: [
      {
        id: 'goal-run',
        title: 'Run three times a week',
        description: 'Short and slow counts.',
        status: 'active',
        kind: 'habit',
        size: 'large',
        sortOrder: 10,
        area: AREA_HEALTH,
        color: '#2e7d57',
        startDate: '2026-01-06',
        targetDate: null,
        progress: { basis: 'period_completion', fraction: 0.5 },
        lastProgressOn: '2026-09-17',
        habit: {
          period: 'week',
          periodStart: '2026-09-14',
          periodEnd: '2026-09-20',
          completedCount: 2,
          targetCount: 4,
          minimumCount: 1,
          minimumFraction: 1,
          minimumMet: true,
        },
        ...TIMES,
      },
      {
        id: 'goal-pages',
        title: 'Morning pages',
        description: null,
        status: 'active',
        kind: 'habit',
        size: 'medium',
        sortOrder: 20,
        area: AREA_CREATIVE,
        color: '#7d4aa8',
        startDate: '2026-08-01',
        targetDate: null,
        // Nothing this week yet: below the minimum is not a failure, and nothing here says it is.
        progress: { basis: 'period_completion', fraction: 0 },
        lastProgressOn: '2026-09-11',
        habit: {
          period: 'week',
          periodStart: '2026-09-14',
          periodEnd: '2026-09-20',
          completedCount: 0,
          targetCount: 3,
          minimumCount: 1,
          minimumFraction: 0,
          minimumMet: false,
        },
        ...TIMES,
      },
      {
        id: 'goal-bike',
        title: 'Save for a new bike',
        description: null,
        status: 'active',
        kind: 'measured',
        size: 'medium',
        sortOrder: 30,
        area: AREA_MONEY,
        color: '#8a6410',
        startDate: '2026-02-01',
        targetDate: '2026-12-31',
        progress: { basis: 'measured_value', fraction: 0.6 },
        lastProgressOn: '2026-09-12',
        measured: {
          unit: 'EUR',
          startValue: 0,
          targetValue: 900,
          currentValue: 540,
          lastMeasuredOn: '2026-09-12',
          // Lower than it was: the tile draws a hairline and one quiet sentence. No red.
          previousValue: 570,
          previousMeasuredOn: '2026-09-05',
        },
        ...TIMES,
      },
      {
        id: 'goal-spanish',
        title: 'Finish the Spanish course',
        description: null,
        status: 'active',
        kind: 'scheduled',
        size: 'medium',
        sortOrder: 40,
        area: AREA_LEARNING,
        color: '#4f52c7',
        startDate: '2026-06-01',
        targetDate: '2026-12-15',
        progress: { basis: 'session_target', fraction: 0.75 },
        lastProgressOn: '2026-09-15',
        scheduled: { targetSessions: 12, plannedCount: 12, completedCount: 9, dueCount: 10 },
        ...TIMES,
      },
      {
        id: 'goal-friends',
        title: 'See friends more often',
        description: null,
        status: 'active',
        kind: 'scheduled',
        size: 'small',
        sortOrder: 50,
        area: AREA_PEOPLE,
        color: '#a6416b',
        startDate: null,
        targetDate: null,
        // Open-ended: no denominator exists, so `fraction` is null and must stay null.
        progress: { basis: 'none', fraction: null },
        lastProgressOn: '2026-09-06',
        scheduled: { targetSessions: null, plannedCount: 2, completedCount: 3, dueCount: 0 },
        ...TIMES,
      },
    ],
  };
}

export function areasPayload(): AreasResponse {
  return {
    areas: [
      { ...AREA_HEALTH, color: '#2e7d57', sortOrder: 10, isSystem: true },
      { ...AREA_LEARNING, color: '#4f52c7', sortOrder: 20, isSystem: true },
      { ...AREA_MONEY, color: '#8a6410', sortOrder: 30, isSystem: true },
      { ...AREA_PEOPLE, color: '#a6416b', sortOrder: 40, isSystem: true },
      { ...AREA_WORK, color: '#14717f', sortOrder: 50, isSystem: true },
      { ...AREA_CREATIVE, color: '#7d4aa8', sortOrder: 60, isSystem: true },
    ],
  };
}

const RUN_GOAL = {
  id: 'goal-run',
  title: 'Morning run',
  kind: 'habit',
  color: '#2e7d57',
  area: AREA_HEALTH,
} as const;

const SPANISH_GOAL = {
  id: 'goal-spanish',
  title: 'Spanish class',
  kind: 'scheduled',
  color: '#4f52c7',
  area: AREA_LEARNING,
} as const;

const FRIENDS_GOAL = {
  id: 'goal-friends',
  title: 'See friends more often',
  kind: 'scheduled',
  color: '#a6416b',
  area: AREA_PEOPLE,
} as const;

/**
 * Entries either side of the mockup week, including the two cases the views cannot work out
 * for themselves: a completed occurrence with no recurrence behind it (logged, not planned) and
 * a still-planned one on a day that has passed (planned, didn't happen).
 */
export const ENTRIES: readonly CalendarEntry[] = [
  {
    id: 'entry-long-run',
    date: '2026-08-31',
    timing: 'untimed',
    startAt: null,
    endAt: null,
    timeZone: LOCAL_ZONE,
    title: 'Long run',
    notes: null,
    status: 'completed',
    completedAt: at(2026, 8, 31, 11, 0),
    recurrenceId: 'rec-run',
    goal: RUN_GOAL,
  },
  {
    id: 'entry-run-mon',
    date: '2026-09-14',
    timing: 'timed',
    startAt: at(2026, 9, 14, 7, 0),
    endAt: at(2026, 9, 14, 7, 40),
    timeZone: LOCAL_ZONE,
    title: null,
    notes: null,
    status: 'completed',
    completedAt: at(2026, 9, 14, 7, 42),
    recurrenceId: 'rec-run',
    goal: RUN_GOAL,
  },
  {
    id: 'entry-spanish-tue',
    date: '2026-09-15',
    timing: 'timed',
    startAt: at(2026, 9, 15, 19, 0),
    endAt: at(2026, 9, 15, 20, 0),
    timeZone: LOCAL_ZONE,
    title: null,
    notes: null,
    // Still planned, and the day has passed.
    status: 'planned',
    completedAt: null,
    recurrenceId: 'rec-spanish',
    goal: SPANISH_GOAL,
  },
  {
    id: 'entry-call-thu',
    date: TODAY_ISO,
    timing: 'untimed',
    startAt: null,
    endAt: null,
    timeZone: LOCAL_ZONE,
    title: 'Call Mum',
    notes: null,
    status: 'planned',
    completedAt: null,
    recurrenceId: null,
    goal: FRIENDS_GOAL,
  },
  {
    id: 'entry-run-thu',
    date: TODAY_ISO,
    timing: 'timed',
    startAt: at(2026, 9, 17, 7, 0),
    endAt: at(2026, 9, 17, 7, 40),
    timeZone: LOCAL_ZONE,
    title: null,
    notes: null,
    // Done, and never planned: it counts exactly as much as a planned one.
    status: 'completed',
    completedAt: at(2026, 9, 17, 7, 41),
    recurrenceId: null,
    goal: RUN_GOAL,
  },
  {
    id: 'entry-standup-thu',
    date: TODAY_ISO,
    timing: 'timed',
    startAt: at(2026, 9, 17, 9, 0),
    endAt: at(2026, 9, 17, 9, 15),
    timeZone: LOCAL_ZONE,
    title: 'Team standup',
    notes: null,
    // Planned, today, and already over by 09:30 — today is never read as missed.
    status: 'planned',
    completedAt: null,
    recurrenceId: 'rec-standup',
    goal: null,
  },
  {
    id: 'entry-spanish-thu',
    date: TODAY_ISO,
    timing: 'timed',
    startAt: at(2026, 9, 17, 18, 30),
    endAt: at(2026, 9, 17, 19, 30),
    timeZone: LOCAL_ZONE,
    title: null,
    notes: null,
    status: 'planned',
    completedAt: null,
    recurrenceId: 'rec-spanish',
    goal: SPANISH_GOAL,
  },
  {
    id: 'entry-run-fri',
    date: '2026-09-18',
    timing: 'timed',
    startAt: at(2026, 9, 18, 7, 0),
    endAt: at(2026, 9, 18, 7, 40),
    timeZone: LOCAL_ZONE,
    title: null,
    notes: null,
    status: 'planned',
    completedAt: null,
    recurrenceId: 'rec-run',
    goal: RUN_GOAL,
  },
  {
    id: 'entry-market-sun',
    date: '2026-09-20',
    timing: 'untimed',
    startAt: null,
    endAt: null,
    timeZone: LOCAL_ZONE,
    // A plain calendar item that drives no goal.
    title: 'Farmers market',
    notes: null,
    status: 'planned',
    completedAt: null,
    recurrenceId: null,
    goal: null,
  },
  {
    id: 'entry-term-oct',
    date: '2026-10-01',
    timing: 'untimed',
    startAt: null,
    endAt: null,
    timeZone: LOCAL_ZONE,
    title: 'New term starts',
    notes: null,
    status: 'planned',
    completedAt: null,
    recurrenceId: null,
    goal: SPANISH_GOAL,
  },
];

/** What `GET /api/calendar` would return for a range: the entries whose day falls inside it. */
export function calendarPayload(from: string, to: string): CalendarResponse {
  return { from, to, entries: ENTRIES.filter((entry) => entry.date >= from && entry.date <= to) };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export interface FetchRoutes {
  goals?: () => Response;
  areas?: () => Response;
  calendar?: (from: string, to: string) => Response;
  health?: () => Response;
}

const HEALTH_PAYLOAD = {
  status: 'ok',
  version: '0.1.1-alpha',
  commit: 'local',
  timestamp: '2026-09-17T09:30:00.000Z',
};

/**
 * Stubs `fetch` for the three product endpoints and /health, and returns the mock so a test can
 * assert on the URLs that were asked for.
 */
export function stubFetch(routes: FetchRoutes = {}): Mock<typeof fetch> {
  const impl = vi.fn<typeof fetch>((input) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, 'http://localhost');

    if (url.pathname === '/api/goals') {
      return Promise.resolve(routes.goals?.() ?? jsonResponse(goalsPayload()));
    }
    if (url.pathname === '/api/areas') {
      return Promise.resolve(routes.areas?.() ?? jsonResponse(areasPayload()));
    }
    if (url.pathname === '/api/calendar') {
      const from = url.searchParams.get('from') ?? '';
      const to = url.searchParams.get('to') ?? '';
      return Promise.resolve(
        routes.calendar?.(from, to) ?? jsonResponse(calendarPayload(from, to)),
      );
    }
    if (url.pathname === '/health') {
      return Promise.resolve(routes.health?.() ?? jsonResponse(HEALTH_PAYLOAD));
    }
    return Promise.resolve(jsonResponse({ error: 'not_found' }, 404));
  });

  vi.stubGlobal('fetch', impl);
  return impl;
}

/** Every calendar range the stub was asked for, in order. */
export function calendarRanges(impl: Mock<typeof fetch>): string[] {
  return impl.mock.calls
    .map(([input]) => (typeof input === 'string' ? input : input instanceof URL ? input.href : ''))
    .filter((href) => href.startsWith('/api/calendar'))
    .map((href) => href.slice('/api/calendar?'.length));
}
