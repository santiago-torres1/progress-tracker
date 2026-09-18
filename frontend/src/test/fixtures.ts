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
import type {
  AreasResponse,
  CalendarEntry,
  CalendarResponse,
  GoalSummary,
  GoalTemplatesResponse,
  GoalsResponse,
  SessionResponse,
} from '../types/api';

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

/** The profile a signed-in visitor reads back: a real zone, and a week that starts on Monday. */
export function sessionPayload(
  overrides: Partial<SessionResponse['session']> = {},
): SessionResponse {
  return {
    session: {
      timeZone: 'Europe/Madrid',
      weekStartsOn: 1,
      isAnonymous: true,
      expiresAt: '2026-12-16T09:30:00.000Z',
      ...overrides,
    },
  };
}

/** Two areas' worth of catalogue — enough to walk the picker without reciting all thirty-six. */
export function templatesPayload(): GoalTemplatesResponse {
  const areas = areasPayload().areas;
  const health = areas[0];
  const learning = areas[1];
  if (health === undefined || learning === undefined) throw new Error('fixture areas missing');

  return {
    areas: [
      {
        area: health,
        templates: [
          {
            id: 'tpl-move',
            slug: 'move-your-body',
            title: 'Move your body',
            areaId: health.id,
            sortOrder: 10,
            repeat: { freq: 'weekly', interval: 1 },
            kind: 'habit',
            habit: { targetCount: 3, minimumCount: 1, period: 'week' },
          },
          {
            id: 'tpl-weight',
            slug: 'reach-a-weight',
            title: 'Reach a weight',
            areaId: health.id,
            sortOrder: 20,
            repeat: null,
            kind: 'measured',
            measured: { unit: 'kg', startValue: null, targetValue: null },
          },
        ],
      },
      {
        area: learning,
        templates: [
          {
            id: 'tpl-course',
            slug: 'finish-a-course',
            title: 'Finish a course',
            areaId: learning.id,
            sortOrder: 10,
            repeat: null,
            kind: 'scheduled',
            scheduled: { targetSessions: 12 },
          },
        ],
      },
    ],
    custom: { kinds: ['habit', 'measured', 'scheduled'], defaultSize: 'medium' },
  };
}

/** One goal from the board, by id, for a write response to hand back recomputed. */
export function goalById(id: string): GoalSummary {
  const goal = goalsPayload().goals.find((item) => item.id === id);
  if (goal === undefined) throw new Error(`No fixture goal ${id}`);
  return goal;
}

/** The same habit with one more completion in the period — what the server would recompute. */
export function habitAfterTick(id: string): GoalSummary {
  const goal = goalById(id);
  if (goal.kind !== 'habit') throw new Error(`${id} is not a habit`);

  const completedCount = goal.habit.completedCount + 1;
  return {
    ...goal,
    progress: { basis: 'period_completion', fraction: completedCount / goal.habit.targetCount },
    habit: { ...goal.habit, completedCount, minimumMet: true, minimumFraction: 1 },
  };
}

/** A completed occurrence, as POST /api/goals/:id/completions returns it. */
export function completionEntry(goalId: string, date = TODAY_ISO): CalendarEntry {
  const goal = goalById(goalId);
  return {
    id: `entry-new-${goalId}`,
    date,
    timing: 'untimed',
    startAt: null,
    endAt: null,
    timeZone: LOCAL_ZONE,
    title: goal.title,
    notes: null,
    status: 'completed',
    completedAt: `${date}T09:30:00.000Z`,
    recurrenceId: null,
    goal: {
      id: goal.id,
      title: goal.title,
      kind: goal.kind,
      color: goal.color,
      area: goal.area,
    },
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** One request the stub saw, reduced to what a test wants to assert on. */
export interface SeenRequest {
  method: string;
  path: string;
  search: string;
  authorization: string | null;
  body: unknown;
}

export interface FetchRoutes {
  goals?: (statuses: string | null) => Response;
  areas?: () => Response;
  calendar?: (from: string, to: string) => Response | Promise<Response>;
  health?: () => Response;
  session?: (method: string, body: unknown) => Response;
  templates?: () => Response;
  /** Anything that writes. Return undefined to fall through to a generic 200. */
  write?: (request: SeenRequest) => Response | undefined;
}

const HEALTH_PAYLOAD = {
  status: 'ok',
  version: '0.2.0-alpha',
  commit: 'local',
  timestamp: '2026-09-17T09:30:00.000Z',
};

export interface ApiStub {
  fetchImpl: Mock<typeof fetch>;
  /** Every request the app made, in order. */
  seen: SeenRequest[];
  /** Just the ones that changed something — what "one request per gesture" is measured against. */
  writes: () => SeenRequest[];
}

function readInit(init: RequestInit | undefined): {
  method: string;
  body: unknown;
  auth: string | null;
} {
  const method = init?.method ?? 'GET';
  const headers = init?.headers;
  let auth: string | null = null;
  if (headers !== undefined && !(headers instanceof Headers) && !Array.isArray(headers)) {
    auth = headers.authorization ?? headers.Authorization ?? null;
  }

  let body: unknown = null;
  if (typeof init?.body === 'string') {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = init.body;
    }
  }
  return { method, body, auth };
}

/**
 * Stubs `fetch` for the whole product API.
 *
 * It records every request, including the Authorization header, because "does this build put a
 * token on its requests" is a thing the tests have to be able to ask — the deployed app answers
 * 401 to everything without one.
 */
export function stubFetch(routes: FetchRoutes = {}): ApiStub {
  const seen: SeenRequest[] = [];

  const impl = vi.fn<typeof fetch>((input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, 'http://localhost');
    const { method, body, auth } = readInit(init);

    const request: SeenRequest = {
      method,
      path: url.pathname,
      search: url.search,
      authorization: auth,
      body,
    };
    seen.push(request);

    if (url.pathname === '/api/session') {
      return Promise.resolve(routes.session?.(method, body) ?? jsonResponse(sessionPayload()));
    }
    if (url.pathname === '/api/goal-templates') {
      return Promise.resolve(routes.templates?.() ?? jsonResponse(templatesPayload()));
    }
    if (url.pathname === '/api/goals' && method === 'GET') {
      const statuses = url.searchParams.get('status');
      return Promise.resolve(routes.goals?.(statuses) ?? jsonResponse(goalsPayload()));
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
    if (method !== 'GET') {
      const answer = routes.write?.(request);
      return Promise.resolve(answer ?? jsonResponse({ ok: true }));
    }
    return Promise.resolve(jsonResponse({ error: 'not_found' }, 404));
  });

  vi.stubGlobal('fetch', impl);
  return {
    fetchImpl: impl,
    seen,
    writes: () => seen.filter((request) => request.method !== 'GET'),
  };
}

/** Every calendar range the stub was asked for, in order. */
export function calendarRanges(stub: ApiStub): string[] {
  return stub.seen
    .filter((request) => request.path === '/api/calendar')
    .map((request) => request.search.replace(/^\?/, ''));
}
