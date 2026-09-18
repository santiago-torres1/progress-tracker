import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import type { SupabaseAdminClient } from '../lib/supabase.js';

/*
 * Route tests for the product API, against a MOCKED Supabase client.
 *
 * What these prove: that every /api route refuses a caller it cannot identify, that the client
 * it serves them with carries their token and the anon key (never the service-role key), the
 * response shapes, ordering, the caching and error contracts, input validation, and that
 * nothing upstream — including the access token — leaks into a body.
 *
 * What they cannot prove is the thing that actually isolates one visitor from another. RLS lives
 * in the database, so it is verified in the database: see the psql transcripts in the PR notes,
 * where a second session reads zero of the first session's goals, entries and check-ins. A mock
 * would happily "prove" isolation that does not exist.
 *
 * Fixtures are copied from a seeded PostgreSQL 17 with all migrations applied, so the two halves
 * line up.
 */

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));

vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@supabase/supabase-js')>()),
  createClient: createClientMock,
}));

const FAKE_URL = 'https://fake-project-ref.supabase.co';
const FAKE_ANON_KEY = 'fake-anon-key-do-not-echo';
const FAKE_SERVICE_ROLE_KEY = 'fake-service-role-key-do-not-echo';

/** Shaped like a JWS compact serialisation, which is all readBearerToken checks. */
const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbm9uLXZpc2l0b3IifQ.not-a-real-signature';
const SESSION_USER_ID = '7f3c1a2b-0000-4000-8000-00000000abcd';

function stubSupabaseEnv(overrides: Record<string, string | undefined> = {}): void {
  const values: Record<string, string | undefined> = {
    SUPABASE_URL: FAKE_URL,
    SUPABASE_ANON_KEY: FAKE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE_ROLE_KEY,
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

function expectNoSecrets(text: string): void {
  for (const secret of [
    FAKE_URL,
    'fake-project-ref',
    FAKE_ANON_KEY,
    FAKE_SERVICE_ROLE_KEY,
    ACCESS_TOKEN,
    SESSION_USER_ID,
    'user_id',
  ]) {
    expect(text).not.toContain(secret);
  }
}

// --- A fake PostgREST builder ------------------------------------------------------------------

interface PostgrestLikeResult {
  data: unknown;
  error: unknown;
  status: number;
}

/** Everything a route did to build one query, so the test can assert the query, not just the JSON. */
interface RecordedQuery {
  table: string;
  columns: string;
  ops: string[];
  signal: AbortSignal | undefined;
}

/** One public.begin_request() call. */
interface RecordedRpc {
  fn: string;
  args: unknown;
  signal: AbortSignal | undefined;
}

interface FakeBuilder extends PromiseLike<PostgrestLikeResult> {
  select(columns: string): FakeBuilder;
  eq(column: string, value: unknown): FakeBuilder;
  in(column: string, values: readonly unknown[]): FakeBuilder;
  or(filter: string): FakeBuilder;
  gte(column: string, value: unknown): FakeBuilder;
  lte(column: string, value: unknown): FakeBuilder;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): FakeBuilder;
  abortSignal(signal: AbortSignal): FakeBuilder;
}

interface FakeRpcBuilder extends PromiseLike<PostgrestLikeResult> {
  abortSignal(signal: AbortSignal): FakeRpcBuilder;
}

const queries: RecordedQuery[] = [];
const rpcCalls: RecordedRpc[] = [];
let respond: (query: RecordedQuery) => Promise<PostgrestLikeResult>;
let respondRpc: (call: RecordedRpc) => Promise<PostgrestLikeResult>;

function rows(data: unknown): Promise<PostgrestLikeResult> {
  return Promise.resolve({ data, error: null, status: 200 });
}

function createBuilder(table: string): FakeBuilder {
  const record: RecordedQuery = { table, columns: '', ops: [], signal: undefined };
  queries.push(record);

  const builder: FakeBuilder = {
    select(columns) {
      record.columns = columns;
      return builder;
    },
    eq(column, value) {
      record.ops.push(`eq:${column}=${String(value)}`);
      return builder;
    },
    in(column, values) {
      record.ops.push(`in:${column}=${values.map(String).join('|')}`);
      return builder;
    },
    or(filter) {
      record.ops.push(`or:${filter}`);
      return builder;
    },
    gte(column, value) {
      record.ops.push(`gte:${column}=${String(value)}`);
      return builder;
    },
    lte(column, value) {
      record.ops.push(`lte:${column}=${String(value)}`);
      return builder;
    },
    order(column, options) {
      const direction = options?.ascending === false ? 'desc' : 'asc';
      record.ops.push(
        `order:${column}:${direction}${options?.nullsFirst === true ? ':nullsfirst' : ''}`,
      );
      return builder;
    },
    abortSignal(signal) {
      record.signal = signal;
      return builder;
    },
    then(onfulfilled, onrejected) {
      return respond(record).then(onfulfilled, onrejected);
    },
  };
  return builder;
}

function createRpcBuilder(fn: string, args: unknown): FakeRpcBuilder {
  const record: RecordedRpc = { fn, args, signal: undefined };
  rpcCalls.push(record);

  const builder: FakeRpcBuilder = {
    abortSignal(signal) {
      record.signal = signal;
      return builder;
    },
    then(onfulfilled, onrejected) {
      return respondRpc(record).then(onfulfilled, onrejected);
    },
  };
  return builder;
}

// One stable client object. Behaviour is swapped through `respond` / `respondRpc`, not through
// the client, so the per-request client construction stays observable via createClientMock.
const fakeClient = {
  from: (table: string) => createBuilder(table),
  rpc: (fn: string, args: unknown) => createRpcBuilder(fn, args),
} as unknown as SupabaseAdminClient;

// --- Fixtures ----------------------------------------------------------------------------------

/** One row of public.begin_request(): an anonymous session, in good standing. */
const SESSION_ROW = {
  user_id: SESSION_USER_ID,
  display_name: 'Me',
  time_zone: 'UTC',
  week_starts_on: 1,
  is_anonymous: true,
  last_seen_at: '2026-09-17T06:00:00+00:00',
  expires_at: '2026-12-16T06:00:00+00:00',
  retry_after_seconds: 0,
};

const HABIT_GOAL_ROW = {
  id: 'd0000000-0000-4000-8000-000000000001',
  title: 'Run three times a week',
  description: 'Tuesday, Thursday, Saturday before work. Any run counts, target day or not.',
  kind: 'habit',
  status: 'active',
  size: 'large',
  sort_order: 10,
  life_area_id: '10000000-0000-4000-8000-000000000001',
  life_area_slug: 'health',
  life_area_name: 'Health & Wellbeing',
  life_area_icon: 'heart',
  color: '#2e7d57',
  start_date: '2026-08-13',
  target_date: null,
  measurement_unit: null,
  start_value: null,
  target_value: null,
  current_value: null,
  last_measured_on: null,
  previous_value: null,
  previous_measured_on: null,
  target_count: 3,
  minimum_count: 1,
  habit_period: 'week',
  period_start: '2026-09-14',
  period_end: '2026-09-20',
  period_completed_count: 1,
  period_minimum_met: true,
  // numeric as a string, which is how PostgREST may render it
  period_minimum_fraction: '1.0000',
  target_sessions: null,
  planned_count: 36,
  completed_count: 14,
  due_count: 18,
  progress_basis: 'period_completion',
  progress_fraction: '0.3333',
  last_progress_on: '2026-09-14',
  created_at: '2026-09-17T06:02:53.813916+00:00',
  updated_at: '2026-09-17T06:02:53.813916+00:00',
};

const MEASURED_GOAL_ROW = {
  ...HABIT_GOAL_ROW,
  id: 'd0000000-0000-4000-8000-000000000002',
  title: 'Get back to 78 kg',
  description: 'Same scale, Sunday mornings, no drama about any single week.',
  kind: 'measured',
  size: 'medium',
  sort_order: 20,
  start_date: '2026-08-06',
  target_date: '2026-12-01',
  measurement_unit: 'kg',
  start_value: '84.0000',
  target_value: '78.0000',
  current_value: '81.6000',
  last_measured_on: '2026-09-14',
  previous_value: '80.9000',
  previous_measured_on: '2026-09-03',
  target_count: null,
  minimum_count: null,
  habit_period: null,
  period_start: null,
  period_end: null,
  period_completed_count: 0,
  period_minimum_met: null,
  period_minimum_fraction: null,
  planned_count: 4,
  completed_count: 4,
  due_count: 4,
  progress_basis: 'measured_value',
  progress_fraction: '0.4000',
};

const SCHEDULED_GOAL_ROW = {
  ...MEASURED_GOAL_ROW,
  id: 'd0000000-0000-4000-8000-000000000006',
  title: 'Weekly 1:1 with Dani',
  description: 'Half an hour on Wednesdays. The one meeting that never gets moved.',
  kind: 'scheduled',
  size: 'small',
  sort_order: 60,
  life_area_id: '10000000-0000-4000-8000-000000000005',
  life_area_slug: 'work',
  life_area_name: 'Work & Career',
  life_area_icon: 'briefcase',
  color: '#14717f',
  start_date: '2026-07-16',
  target_date: null,
  measurement_unit: null,
  start_value: null,
  target_value: null,
  current_value: null,
  last_measured_on: null,
  previous_value: null,
  previous_measured_on: null,
  target_sessions: null,
  planned_count: 17,
  completed_count: 8,
  due_count: 9,
  progress_basis: 'session_adherence',
  // numeric as a JSON number, the other rendering PostgREST may use
  progress_fraction: 0.8889,
  last_progress_on: '2026-09-16',
};

const CALENDAR_GOAL_ROWS = [
  {
    id: 'd0000000-0000-4000-8000-000000000001',
    title: 'Run three times a week',
    kind: 'habit',
    color: '#2e7d57',
    life_area_id: '10000000-0000-4000-8000-000000000001',
    life_area_slug: 'health',
    life_area_name: 'Health & Wellbeing',
    life_area_icon: 'heart',
  },
  {
    id: 'd0000000-0000-4000-8000-000000000008',
    title: 'Read before bed',
    kind: 'habit',
    color: '#7d4aa8',
    life_area_id: '10000000-0000-4000-8000-000000000006',
    life_area_slug: 'creative',
    life_area_name: 'Creativity & Hobbies',
    life_area_icon: 'palette',
  },
];

const UNTIMED_ENTRY_ROW = {
  id: '98456e48-ee2f-4886-b94f-6351729d2503',
  goal_id: 'd0000000-0000-4000-8000-000000000008',
  recurrence_id: null,
  title: 'Read',
  notes: null,
  entry_date: '2026-09-17',
  start_at: null,
  end_at: null,
  time_zone: 'UTC',
  status: 'completed',
  completed_at: '2026-09-17T06:02:56.042272+00:00',
};

const TIMED_ENTRY_ROW = {
  id: '36305d32-ece1-42c4-879e-4980f04ca553',
  goal_id: 'd0000000-0000-4000-8000-000000000001',
  recurrence_id: 'd1000000-0000-4000-8000-000000000001',
  // NULL title: most of the demo's entries look like this, and mean "show the goal's title"
  title: null,
  notes: null,
  entry_date: '2026-09-17',
  start_at: '2026-09-17T07:00:00+00:00',
  end_at: '2026-09-17T07:45:00+00:00',
  time_zone: 'UTC',
  status: 'planned',
  completed_at: null,
};

const GOAL_LESS_ENTRY_ROW = {
  id: 'dc000000-0000-4000-8000-000000000002',
  goal_id: null,
  recurrence_id: null,
  title: "Mum's birthday",
  notes: null,
  entry_date: '2026-09-18',
  start_at: null,
  end_at: null,
  time_zone: 'UTC',
  status: 'planned',
  completed_at: null,
};

const LIFE_AREA_ROWS = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    slug: 'health',
    name: 'Health & Wellbeing',
    color: '#2e7d57',
    icon: 'heart',
    sort_order: 10,
    is_system: true,
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    slug: 'learning',
    name: 'Learning & Skills',
    color: '#4f52c7',
    icon: 'book',
    sort_order: 20,
    is_system: true,
  },
];

/** The goal the recurrence fixtures below hang off. */
const SCHEDULED_GOAL_ID = 'd0000000-0000-4000-8000-000000000003';

/**
 * Two rules on one goal, as PostgREST renders public.recurrences: `byweekday` as an array of
 * numbers, `time` columns as `HH:MM:SS` strings, and a paused rule alongside a live one.
 */
const RECURRENCE_ROWS = [
  {
    id: 'd1000000-0000-4000-8000-000000000002',
    goal_id: SCHEDULED_GOAL_ID,
    freq: 'weekly',
    interval_count: 1,
    byweekday: [2, 4],
    start_date: '2026-07-02',
    until_date: null,
    start_time: '19:00:00',
    end_time: '20:00:00',
    time_zone: 'Europe/Madrid',
    generated_through: '2026-12-15',
    is_active: true,
    created_at: '2026-07-02T08:00:00+00:00',
    updated_at: '2026-07-02T08:00:00+00:00',
  },
  {
    id: 'd1000000-0000-4000-8000-000000000009',
    goal_id: SCHEDULED_GOAL_ID,
    freq: 'monthly',
    interval_count: 2,
    byweekday: null,
    start_date: '2026-08-01',
    until_date: '2026-11-30',
    start_time: null,
    end_time: null,
    time_zone: 'Europe/Madrid',
    generated_through: null,
    is_active: false,
    created_at: '2026-08-01T08:00:00+00:00',
    updated_at: '2026-08-02T09:30:00+00:00',
  },
];

/** A signed-in visitor's request. Every /api route needs one. */
function get(path: string, app = createApp()): request.Test {
  return request(app).get(path).set('Authorization', `Bearer ${ACCESS_TOKEN}`);
}

beforeEach(() => {
  createClientMock.mockReset().mockReturnValue(fakeClient);
  queries.length = 0;
  rpcCalls.length = 0;
  respond = () => rows([]);
  respondRpc = () => rows([SESSION_ROW]);
  stubSupabaseEnv();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const ROUTES = [
  ['/api/goals', '/api/goals'],
  ['/api/calendar', '/api/calendar?from=2026-09-01&to=2026-09-30'],
  ['/api/areas', '/api/areas'],
  ['/api/goals/:goalId/recurrences', `/api/goals/${SCHEDULED_GOAL_ID}/recurrences`],
] as const;

// --- Identity: who may call, and as whom ------------------------------------------------------

describe.each(ROUTES)('%s identity', (_name, path) => {
  it('refuses a request with no Authorization header, without touching Supabase', async () => {
    const res = await request(createApp()).get(path);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized', reason: 'missing_token' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(createClientMock).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
    expect(queries).toHaveLength(0);
  });

  it.each([
    ['a bare token', 'not-a-bearer-token'],
    ['the wrong scheme', 'Basic dXNlcjpwYXNz'],
    ['Bearer with nothing after it', 'Bearer'],
    ['a token that is not JWT-shaped', 'Bearer abcdef'],
    ['a token with too many segments', 'Bearer a.b.c.d'],
  ])('refuses %s as malformed, without touching Supabase', async (_case, header) => {
    const res = await request(createApp()).get(path).set('Authorization', header);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized', reason: 'malformed_token' });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('reports invalid_token, and no upstream detail, when Supabase rejects the token', async () => {
    respondRpc = () =>
      Promise.resolve({
        data: null,
        error: { code: 'PGRST301', message: 'JWT expired', details: null, hint: null },
        status: 401,
      });

    const res = await get(path);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized', reason: 'invalid_token' });
    expect(res.text).not.toContain('PGRST301');
    expect(res.text).not.toContain('JWT expired');
    expectNoSecrets(res.text);
    // Rejected before any product query ran.
    expect(queries).toHaveLength(0);
  });

  it('reports no_profile when the token is accepted but maps to no account', async () => {
    respondRpc = () => rows([]);

    const res = await get(path);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized', reason: 'no_profile' });
    expect(queries).toHaveLength(0);
  });

  it('builds a client from the anon key plus the caller token — never the service-role key', async () => {
    await get(path);

    expect(createClientMock).toHaveBeenCalledTimes(1);
    const [url, key, options] = createClientMock.mock.calls[0] as [
      string,
      string,
      { global?: { headers?: Record<string, string> } },
    ];
    expect(url).toBe(FAKE_URL);
    expect(key).toBe(FAKE_ANON_KEY);
    expect(key).not.toBe(FAKE_SERVICE_ROLE_KEY);
    expect(options.global?.headers?.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it('builds a fresh client per request, so no token outlives the request that brought it', async () => {
    const app = createApp();
    await get(path, app);
    await get(path, app);

    expect(createClientMock).toHaveBeenCalledTimes(2);
  });

  it('charges the request against the read quota, under the same deadline as the query', async () => {
    await get(path);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.fn).toBe('begin_request');
    expect(rpcCalls[0]?.args).toEqual({ p_kind: 'read' });
    expect(rpcCalls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses a caller over quota with 429 and Retry-After, and runs no query', async () => {
    respondRpc = () => rows([{ ...SESSION_ROW, retry_after_seconds: 19 }]);

    const res = await get(path);

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'rate_limited', retryAfterSeconds: 19 });
    expect(res.headers['retry-after']).toBe('19');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(queries).toHaveLength(0);
  });

  it('never lets a response be reused for another caller', async () => {
    const res = await get(path);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers.vary).toContain('Authorization');
  });
});

// --- GET /api/goals ---------------------------------------------------------------------------

describe('GET /api/goals', () => {
  it('shapes each kind of goal for the tile that renders it', async () => {
    respond = () => rows([HABIT_GOAL_ROW, MEASURED_GOAL_ROW, SCHEDULED_GOAL_ROW]);

    const res = await get('/api/goals');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      goals: [
        {
          id: 'd0000000-0000-4000-8000-000000000001',
          title: 'Run three times a week',
          description:
            'Tuesday, Thursday, Saturday before work. Any run counts, target day or not.',
          status: 'active',
          size: 'large',
          sortOrder: 10,
          area: {
            id: '10000000-0000-4000-8000-000000000001',
            slug: 'health',
            name: 'Health & Wellbeing',
            icon: 'heart',
          },
          color: '#2e7d57',
          startDate: '2026-08-13',
          targetDate: null,
          progress: { basis: 'period_completion', fraction: 0.3333 },
          lastProgressOn: '2026-09-14',
          createdAt: '2026-09-17T06:02:53.813Z',
          updatedAt: '2026-09-17T06:02:53.813Z',
          kind: 'habit',
          habit: {
            period: 'week',
            periodStart: '2026-09-14',
            periodEnd: '2026-09-20',
            completedCount: 1,
            targetCount: 3,
            minimumCount: 1,
            minimumFraction: 1,
            minimumMet: true,
          },
        },
        {
          id: 'd0000000-0000-4000-8000-000000000002',
          title: 'Get back to 78 kg',
          description: 'Same scale, Sunday mornings, no drama about any single week.',
          status: 'active',
          size: 'medium',
          sortOrder: 20,
          area: {
            id: '10000000-0000-4000-8000-000000000001',
            slug: 'health',
            name: 'Health & Wellbeing',
            icon: 'heart',
          },
          color: '#2e7d57',
          startDate: '2026-08-06',
          targetDate: '2026-12-01',
          progress: { basis: 'measured_value', fraction: 0.4 },
          lastProgressOn: '2026-09-14',
          createdAt: '2026-09-17T06:02:53.813Z',
          updatedAt: '2026-09-17T06:02:53.813Z',
          kind: 'measured',
          measured: {
            unit: 'kg',
            startValue: 84,
            targetValue: 78,
            currentValue: 81.6,
            lastMeasuredOn: '2026-09-14',
            previousValue: 80.9,
            previousMeasuredOn: '2026-09-03',
          },
        },
        {
          id: 'd0000000-0000-4000-8000-000000000006',
          title: 'Weekly 1:1 with Dani',
          description: 'Half an hour on Wednesdays. The one meeting that never gets moved.',
          status: 'active',
          size: 'small',
          sortOrder: 60,
          area: {
            id: '10000000-0000-4000-8000-000000000005',
            slug: 'work',
            name: 'Work & Career',
            icon: 'briefcase',
          },
          color: '#14717f',
          startDate: '2026-07-16',
          targetDate: null,
          progress: { basis: 'session_adherence', fraction: 0.8889 },
          lastProgressOn: '2026-09-16',
          createdAt: '2026-09-17T06:02:53.813Z',
          updatedAt: '2026-09-17T06:02:53.813Z',
          kind: 'scheduled',
          scheduled: {
            targetSessions: null,
            plannedCount: 17,
            completedCount: 8,
            dueCount: 9,
          },
        },
      ],
    });
  });

  it('asks goal_dashboard for active goals in canvas order, and names no user anywhere', async () => {
    respond = () => rows([HABIT_GOAL_ROW]);

    await get('/api/goals');

    expect(queries).toHaveLength(1);
    const [query] = queries;
    expect(query?.table).toBe('goal_dashboard');
    expect(query?.columns.split(',')).toContain('period_minimum_fraction');
    expect(query?.columns.split(',')).not.toContain('user_id');
    // No user_id filter: the goals_select policy is the filter, and duplicating it here would
    // mask a broken policy instead of defending against one.
    expect(query?.ops).toEqual([
      'eq:status=active',
      'order:sort_order:asc',
      'order:created_at:asc',
    ]);
    expect(query?.ops.join(' ')).not.toContain('user_id');
    // The timeout budget is real only if the signal actually reaches the query.
    expect(query?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns an empty board for a brand-new visitor rather than somebody else’s goals', async () => {
    respond = () => rows([]);

    const res = await get('/api/goals');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ goals: [] });
  });

  it('leaks no identifiers', async () => {
    respond = () => rows([HABIT_GOAL_ROW, MEASURED_GOAL_ROW]);

    const res = await get('/api/goals');

    expectNoSecrets(res.text);
  });
});

// --- GET /api/calendar ------------------------------------------------------------------------

describe('GET /api/calendar', () => {
  function respondWithCalendar(): void {
    respond = (query) =>
      query.table === 'calendar_entries'
        ? rows([UNTIMED_ENTRY_ROW, TIMED_ENTRY_ROW, GOAL_LESS_ENTRY_ROW])
        : rows(CALENDAR_GOAL_ROWS);
  }

  it('returns timed, untimed and goal-less entries, each carrying its goal', async () => {
    respondWithCalendar();

    const res = await get('/api/calendar?from=2026-09-17&to=2026-09-18');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      from: '2026-09-17',
      to: '2026-09-18',
      entries: [
        {
          id: '98456e48-ee2f-4886-b94f-6351729d2503',
          date: '2026-09-17',
          timeZone: 'UTC',
          title: 'Read',
          notes: null,
          status: 'completed',
          completedAt: '2026-09-17T06:02:56.042Z',
          recurrenceId: null,
          goal: {
            id: 'd0000000-0000-4000-8000-000000000008',
            title: 'Read before bed',
            kind: 'habit',
            color: '#7d4aa8',
            area: {
              id: '10000000-0000-4000-8000-000000000006',
              slug: 'creative',
              name: 'Creativity & Hobbies',
              icon: 'palette',
            },
          },
          timing: 'untimed',
          startAt: null,
          endAt: null,
        },
        {
          id: '36305d32-ece1-42c4-879e-4980f04ca553',
          date: '2026-09-17',
          timeZone: 'UTC',
          // the entry has no title of its own, so it borrows the goal's
          title: 'Run three times a week',
          notes: null,
          status: 'planned',
          completedAt: null,
          recurrenceId: 'd1000000-0000-4000-8000-000000000001',
          goal: {
            id: 'd0000000-0000-4000-8000-000000000001',
            title: 'Run three times a week',
            kind: 'habit',
            color: '#2e7d57',
            area: {
              id: '10000000-0000-4000-8000-000000000001',
              slug: 'health',
              name: 'Health & Wellbeing',
              icon: 'heart',
            },
          },
          timing: 'timed',
          startAt: '2026-09-17T07:00:00.000Z',
          endAt: '2026-09-17T07:45:00.000Z',
        },
        {
          id: 'dc000000-0000-4000-8000-000000000002',
          date: '2026-09-18',
          timeZone: 'UTC',
          title: "Mum's birthday",
          notes: null,
          status: 'planned',
          completedAt: null,
          recurrenceId: null,
          goal: null,
          timing: 'untimed',
          startAt: null,
          endAt: null,
        },
      ],
    });
    expectNoSecrets(res.text);
  });

  it('queries the range on entry_date, untimed entries first, then looks up only the goals it saw', async () => {
    respondWithCalendar();

    await get('/api/calendar?from=2026-09-17&to=2026-09-18');

    expect(queries).toHaveLength(2);
    expect(queries[0]?.table).toBe('calendar_entries');
    expect(queries[0]?.ops).toEqual([
      'gte:entry_date=2026-09-17',
      'lte:entry_date=2026-09-18',
      'order:entry_date:asc',
      'order:start_at:asc:nullsfirst',
    ]);
    expect(queries[1]?.table).toBe('goal_dashboard');
    expect(queries[1]?.ops).toEqual([
      'in:id=d0000000-0000-4000-8000-000000000008|d0000000-0000-4000-8000-000000000001',
    ]);
    // Both round-trips run as the caller, on the one client built for this request.
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  it('skips the goal lookup entirely when nothing in the range is goal-linked', async () => {
    respond = () => rows([GOAL_LESS_ENTRY_ROW]);

    const res = await get('/api/calendar?from=2026-09-18&to=2026-09-18');

    expect(res.status).toBe(200);
    expect(queries).toHaveLength(1);
  });

  it.each([
    ['both parameters missing', '', 'missing_parameter', 'from and to required'],
    ['only from', '?from=2026-09-01', 'missing_parameter', 'to required'],
    [
      'a repeated parameter',
      '?from=2026-09-01&from=2026-09-02&to=2026-09-30',
      'missing_parameter',
      '',
    ],
    [
      'a nonsense date',
      '?from=yesterday&to=2026-09-30',
      'invalid_date',
      'from must be a real calendar date',
    ],
    ['a date that does not exist', '?from=2026-02-30&to=2026-03-30', 'invalid_date', ''],
    ['a month that does not exist', '?from=2026-13-01&to=2026-13-02', 'invalid_date', ''],
    ['a non-ISO format', '?from=01-09-2026&to=30-09-2026', 'invalid_date', ''],
    [
      'to before from',
      '?from=2026-09-30&to=2026-09-01',
      'invalid_range',
      'from must be on or before to',
    ],
    [
      'a range longer than a year',
      '?from=2026-01-01&to=2027-01-02',
      'range_too_long',
      'at most 366 days',
    ],
  ])(
    'rejects %s with 400 and a message the caller can act on',
    async (_case, query, error, hint) => {
      respondWithCalendar();

      const res = await get(`/api/calendar${query}`);

      expect(res.status).toBe(400);
      expect((res.body as { error: unknown }).error).toBe(error);
      expect((res.body as { message: string }).message).toContain(hint);
      expect(res.headers['cache-control']).toBe('no-store');
      // A rejected request must never have reached Supabase — not even to resolve the session.
      expect(queries).toHaveLength(0);
      expect(rpcCalls).toHaveLength(0);
    },
  );

  it('validates the range before authenticating, so a bad request costs no round trip', async () => {
    const res = await request(createApp()).get('/api/calendar?from=2026-09-30&to=2026-09-01');

    expect(res.status).toBe(400);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('accepts a range of exactly the maximum length', async () => {
    const res = await get('/api/calendar?from=2026-01-01&to=2027-01-01');

    expect(res.status).toBe(200);
  });

  it('accepts a single day', async () => {
    const res = await get('/api/calendar?from=2026-09-17&to=2026-09-17');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: '2026-09-17', to: '2026-09-17', entries: [] });
  });
});

// --- GET /api/areas ---------------------------------------------------------------------------

describe('GET /api/areas', () => {
  it('returns the life areas for the dashboard key', async () => {
    respond = () => rows(LIFE_AREA_ROWS);

    const res = await get('/api/areas');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      areas: [
        {
          id: '10000000-0000-4000-8000-000000000001',
          slug: 'health',
          name: 'Health & Wellbeing',
          color: '#2e7d57',
          icon: 'heart',
          sortOrder: 10,
          isSystem: true,
        },
        {
          id: '10000000-0000-4000-8000-000000000002',
          slug: 'learning',
          name: 'Learning & Skills',
          color: '#4f52c7',
          icon: 'book',
          sortOrder: 20,
          isSystem: true,
        },
      ],
    });
    expectNoSecrets(res.text);
  });

  it('asks for areas in legend order and lets the policy decide which ones', async () => {
    respond = () => rows(LIFE_AREA_ROWS);

    await get('/api/areas');

    expect(queries[0]?.table).toBe('life_areas');
    expect(queries[0]?.ops).toEqual(['order:sort_order:asc', 'order:name:asc']);
    expect(queries[0]?.ops.join(' ')).not.toContain('user_id');
  });
});

describe('GET /api/goals/:goalId/recurrences', () => {
  const path = `/api/goals/${SCHEDULED_GOAL_ID}/recurrences`;

  it("returns the goal's rules, paused ones included", async () => {
    respond = () => rows(RECURRENCE_ROWS);

    const res = await get(path);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      recurrences: [
        {
          id: 'd1000000-0000-4000-8000-000000000002',
          goalId: SCHEDULED_GOAL_ID,
          freq: 'weekly',
          interval: 1,
          byWeekday: [2, 4],
          startDate: '2026-07-02',
          untilDate: null,
          startTime: '19:00:00',
          endTime: '20:00:00',
          timeZone: 'Europe/Madrid',
          generatedThrough: '2026-12-15',
          isActive: true,
          createdAt: '2026-07-02T08:00:00.000Z',
          updatedAt: '2026-07-02T08:00:00.000Z',
        },
        {
          id: 'd1000000-0000-4000-8000-000000000009',
          goalId: SCHEDULED_GOAL_ID,
          freq: 'monthly',
          interval: 2,
          byWeekday: null,
          startDate: '2026-08-01',
          untilDate: '2026-11-30',
          startTime: null,
          endTime: null,
          timeZone: 'Europe/Madrid',
          generatedThrough: null,
          isActive: false,
          createdAt: '2026-08-01T08:00:00.000Z',
          updatedAt: '2026-08-02T09:30:00.000Z',
        },
      ],
    });
    expectNoSecrets(res.text);
  });

  it('filters on the goal alone and lets the policy decide whose it is', async () => {
    respond = () => rows(RECURRENCE_ROWS);

    await get(path);

    expect(queries[0]?.table).toBe('recurrences');
    expect(queries[0]?.ops).toEqual([
      `eq:goal_id=${SCHEDULED_GOAL_ID}`,
      'order:start_date:asc',
      'order:created_at:asc',
      'order:id:asc',
    ]);
    expect(queries[0]?.columns).not.toContain('user_id');
    expect(queries[0]?.ops.join(' ')).not.toContain('user_id');
  });

  it('answers with an empty list, not a 404, when the goal has no rules', async () => {
    respond = () => rows([]);

    const res = await get(path);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recurrences: [] });
  });

  it("answers the same empty list for an id that is not the caller's", async () => {
    // What the database returns for another session's goal: the rows exist and are invisible.
    respond = () => rows([]);

    const res = await get(`/api/goals/d0000000-0000-4000-8000-0000000000ff/recurrences`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recurrences: [] });
  });

  it('rejects a malformed goal id before touching Supabase', async () => {
    const res = await get('/api/goals/not-an-id/recurrences');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'invalid_request',
      message: 'goalId must be an id.',
      field: 'goalId',
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(createClientMock).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it('is charged against the read quota, not the write one', async () => {
    await get(path);

    expect(rpcCalls[0]?.args).toEqual({ p_kind: 'read' });
  });
});

// --- Failure modes, shared by every read route -------------------------------------------------

describe.each(ROUTES)('%s when the data layer is unavailable', (_name, path) => {
  it('reports 503 missing_env, and builds no client, when Supabase is not configured', async () => {
    stubSupabaseEnv({
      SUPABASE_URL: undefined,
      SUPABASE_ANON_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    });

    const res = await get(path);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: 'unavailable',
      reason: 'missing_env',
      missing: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(createClientMock).not.toHaveBeenCalled();
    expect(queries).toHaveLength(0);
  });

  it('names only the variables that are actually missing', async () => {
    stubSupabaseEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined });

    const res = await get(path);

    expect(res.status).toBe(503);
    expect((res.body as { missing: unknown }).missing).toEqual(['SUPABASE_SERVICE_ROLE_KEY']);
  });

  it('reports 503 upstream_error without echoing the upstream failure', async () => {
    respond = () =>
      Promise.resolve({
        data: null,
        error: {
          code: '42P01',
          message: 'relation "public.goal_dashboard" does not exist',
          details: `connection to ${FAKE_URL} using key ${FAKE_SERVICE_ROLE_KEY}`,
          hint: 'check the schema',
        },
        status: 404,
      });

    const res = await get(path);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'unavailable', reason: 'upstream_error' });
    expect(res.text).not.toContain('42P01');
    expect(res.text).not.toContain('does not exist');
    expect(res.text).not.toContain('check the schema');
    expectNoSecrets(res.text);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('reports 503 upstream_error when the session RPC itself fails', async () => {
    respondRpc = () =>
      Promise.resolve({
        data: null,
        error: { code: '42883', message: 'function public.begin_request(text) does not exist' },
        status: 404,
      });

    const res = await get(path);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'unavailable', reason: 'upstream_error' });
    expect(res.text).not.toContain('begin_request');
  });

  it('reports 503 upstream_error when a column is missing from the answer', async () => {
    // A row from a view that has drifted away from src/types/database.ts.
    respond = (query) =>
      rows([
        query.table === 'life_areas'
          ? { id: 'a', slug: 'health', name: 'Health' }
          : query.table === 'calendar_entries'
            ? { id: 'a', goal_id: null }
            : { id: 'a', title: 'x' },
      ]);

    const res = await get(path);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'unavailable', reason: 'upstream_error' });
  });

  it('reports 503 upstream_error when the session row has drifted', async () => {
    respondRpc = () => rows([{ user_id: SESSION_USER_ID }]);

    const res = await get(path);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'unavailable', reason: 'upstream_error' });
  });

  it('reports 503 timeout, and gives up, when Supabase does not answer in time', async () => {
    respond = (query) =>
      new Promise((resolve) => {
        query.signal?.addEventListener('abort', () => {
          // What postgrest-js resolves with on abort: an error object, status 0.
          resolve({
            data: null,
            error: {
              code: '',
              message: 'AbortError: The operation was aborted',
              details: '',
              hint: '',
            },
            status: 0,
          });
        });
      });

    const res = await get(path, createApp({ readTimeoutMs: 25 }));

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'unavailable', reason: 'timeout' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('reports 503 timeout even if the query never settles at all', async () => {
    respond = () => new Promise<PostgrestLikeResult>(() => undefined);

    const res = await get(path, createApp({ readTimeoutMs: 25 }));

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'unavailable', reason: 'timeout' });
  });

  it('reports 503 timeout when the session RPC hangs', async () => {
    respondRpc = () => new Promise<PostgrestLikeResult>(() => undefined);

    const res = await get(path, createApp({ readTimeoutMs: 25 }));

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'unavailable', reason: 'timeout' });
  });
});

// --- The read surface is still exactly the read surface -----------------------------------------

describe('the shape of the API', () => {
  /**
   * Phase 2 added writes under /api/goals only. Everything else is still read-only, and this is
   * the test that says so: a write to a reference-data route is a 404 from the router, before any
   * session is resolved, rather than a handler nobody meant to add.
   */
  it.each([
    ['post', '/api/calendar'],
    ['patch', '/api/calendar'],
    ['delete', '/api/calendar'],
    ['post', '/api/areas'],
    ['patch', '/api/areas'],
    ['delete', '/api/areas'],
    ['post', '/api/goal-templates'],
    ['patch', '/api/goal-templates'],
    ['delete', '/api/goal-templates'],
    // The goals collection takes POST, but a PUT over the whole board is not a thing.
    ['put', '/api/goals'],
    // The session takes GET and PATCH: it is one row that already exists and is never removed.
    ['post', '/api/session'],
    ['delete', '/api/session'],
  ] as const)('has no %s handler on %s', async (method, path) => {
    const res = await request(createApp())
      [method](path)
      .set('Authorization', `Bearer ${ACCESS_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('serves the reads on exactly the paths they have always been on', async () => {
    for (const [, path] of ROUTES) {
      const res = await get(path);
      expect(res.status).toBe(200);
    }
  });
});
