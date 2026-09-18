import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { asRows, type UnknownRow } from '../lib/row.js';
import type { SupabaseAdminClient } from '../lib/supabase.js';

/*
 * Route tests for the write API, against a MOCKED Supabase client.
 *
 * What these prove is what a mock can honestly prove: that a body is validated before anything is
 * spent on it, that the columns and RPC arguments sent to Supabase are the ones the contract says,
 * that `user_id` comes from the session and a body cannot move it, that every write is charged
 * against the WRITE quota, and that a refusal is rendered as a short code with nothing upstream in
 * it.
 *
 * What they cannot prove is isolation, atomicity or the caps, because all three live in the
 * database. Those are verified against a real PostgreSQL 17 with every migration and the seed
 * applied — see the transcripts in the PR notes, where a second session is refused on every write
 * path, a half-applied reorder is impossible, and complete -> undo returns a goal's progress to
 * exactly its previous value. A mock would happily "prove" all of it without any of it being true.
 */

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));

vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@supabase/supabase-js')>()),
  createClient: createClientMock,
}));

const FAKE_URL = 'https://fake-project-ref.supabase.co';
const FAKE_ANON_KEY = 'fake-anon-key-do-not-echo';
const FAKE_SERVICE_ROLE_KEY = 'fake-service-role-key-do-not-echo';

const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbm9uLXZpc2l0b3IifQ.not-a-real-signature';
const SESSION_USER_ID = '7f3c1a2b-0000-4000-8000-00000000abcd';
const OTHER_USER_ID = '00000000-dead-4000-8000-000000000bad';

const GOAL_ID = 'a1000000-0000-4000-8000-000000000001';
const ENTRY_ID = 'c1000000-0000-4000-8000-000000000001';
const MEASUREMENT_ID = 'e1000000-0000-4000-8000-000000000001';
const RULE_ID = 'f1000000-0000-4000-8000-000000000001';

function stubSupabaseEnv(): void {
  vi.stubEnv('SUPABASE_URL', FAKE_URL);
  vi.stubEnv('SUPABASE_ANON_KEY', FAKE_ANON_KEY);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', FAKE_SERVICE_ROLE_KEY);
}

function expectNoSecrets(text: string): void {
  for (const secret of [
    FAKE_URL,
    'fake-project-ref',
    FAKE_ANON_KEY,
    FAKE_SERVICE_ROLE_KEY,
    ACCESS_TOKEN,
    SESSION_USER_ID,
    OTHER_USER_ID,
    'user_id',
  ]) {
    expect(text).not.toContain(secret);
  }
}

// --- A fake PostgREST builder -------------------------------------------------------------------

interface PostgrestLikeResult {
  data: unknown;
  error: unknown;
  status: number;
}

/** Everything a route did to build one statement, so a test can assert the write, not just the JSON. */
interface RecordedQuery {
  table: string;
  verb: 'select' | 'insert' | 'update' | 'delete';
  payload: unknown;
  columns: string;
  ops: string[];
  signal: AbortSignal | undefined;
}

interface RecordedRpc {
  fn: string;
  args: unknown;
  signal: AbortSignal | undefined;
}

interface FakeBuilder extends PromiseLike<PostgrestLikeResult> {
  select(columns?: string): FakeBuilder;
  insert(payload: unknown): FakeBuilder;
  update(payload: unknown): FakeBuilder;
  delete(): FakeBuilder;
  eq(column: string, value: unknown): FakeBuilder;
  in(column: string, values: readonly unknown[]): FakeBuilder;
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

/** A PostgREST error body, exactly as postgrest-js surfaces one. */
function fails(
  code: string,
  message: string,
  details: string | null = null,
  status = 400,
): Promise<PostgrestLikeResult> {
  return Promise.resolve({ data: null, error: { code, message, details, hint: null }, status });
}

function createBuilder(table: string): FakeBuilder {
  const record: RecordedQuery = {
    table,
    verb: 'select',
    payload: undefined,
    columns: '',
    ops: [],
    signal: undefined,
  };
  queries.push(record);

  const builder: FakeBuilder = {
    select(columns) {
      record.columns = columns ?? '';
      return builder;
    },
    insert(payload) {
      record.verb = 'insert';
      record.payload = payload;
      return builder;
    },
    update(payload) {
      record.verb = 'update';
      record.payload = payload;
      return builder;
    },
    delete() {
      record.verb = 'delete';
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
    order(column, options) {
      record.ops.push(`order:${column}:${options?.ascending === false ? 'desc' : 'asc'}`);
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

const fakeClient = {
  from: (table: string) => createBuilder(table),
  rpc: (fn: string, args: unknown) => createRpcBuilder(fn, args),
} as unknown as SupabaseAdminClient;

// --- Fixtures, copied from a seeded PostgreSQL 17 -----------------------------------------------

const SESSION_ROW = {
  user_id: SESSION_USER_ID,
  display_name: 'Me',
  time_zone: 'UTC',
  week_starts_on: 1,
  is_anonymous: true,
  last_seen_at: '2026-09-18T06:00:00+00:00',
  expires_at: '2026-12-17T06:00:00+00:00',
  retry_after_seconds: 0,
};

/** One row of public.goal_dashboard — the tile every write answers with. */
const HABIT_TILE_ROW = {
  id: GOAL_ID,
  title: 'Move your body',
  description: null,
  kind: 'habit',
  status: 'active',
  size: 'large',
  sort_order: 10,
  life_area_id: '10000000-0000-4000-8000-000000000001',
  life_area_slug: 'health',
  life_area_name: 'Health & Wellbeing',
  life_area_icon: 'heart',
  color: '#2e7d57',
  start_date: '2026-08-21',
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
  period_minimum_fraction: '1.0000',
  target_sessions: null,
  planned_count: 1,
  completed_count: 1,
  due_count: 1,
  progress_basis: 'period_completion',
  progress_fraction: '0.3333',
  last_progress_on: '2026-09-18',
  created_at: '2026-09-18T03:21:25.176946+00:00',
  updated_at: '2026-09-18T03:21:25.176946+00:00',
};

/** One row of public.complete_occurrence(). */
const COMPLETION_ROW = {
  created: true,
  id: ENTRY_ID,
  goal_id: GOAL_ID,
  recurrence_id: null,
  title: null,
  notes: null,
  entry_date: '2026-09-18',
  start_at: null,
  end_at: null,
  time_zone: 'UTC',
  status: 'completed',
  completed_at: '2026-09-18T03:22:10.101010+00:00',
  created_by_completion: true,
};

const UNDO_ROW = { ...COMPLETION_ROW, created: undefined, action: 'deleted' };

const MEASUREMENT_ROW = {
  id: MEASUREMENT_ID,
  goal_id: GOAL_ID,
  calendar_entry_id: null,
  occurred_on: '2026-09-18',
  value: '81.6000',
  note: 'After the trip.',
  created_at: '2026-09-18T03:25:00+00:00',
  updated_at: '2026-09-18T03:25:00+00:00',
};

const RECURRENCE_ROW = {
  id: RULE_ID,
  goal_id: GOAL_ID,
  freq: 'weekly',
  interval_count: 1,
  byweekday: [2, 4],
  start_date: '2026-09-21',
  until_date: null,
  start_time: '19:00:00',
  end_time: '20:00:00',
  time_zone: 'Europe/Madrid',
  generated_through: '2026-12-17',
  is_active: true,
  created_at: '2026-09-18T03:30:00+00:00',
  updated_at: '2026-09-18T03:30:00+00:00',
  occurrences_removed: 0,
  occurrences_created: 26,
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

const TEMPLATE_ROWS = [
  {
    id: '20000000-0000-4000-8000-000000000101',
    life_area_id: '10000000-0000-4000-8000-000000000001',
    slug: 'move-your-body',
    title: 'Move your body',
    kind: 'habit',
    suggested_measurement_unit: null,
    suggested_start_value: null,
    suggested_target_value: null,
    suggested_target_count: 3,
    suggested_minimum_count: 1,
    suggested_habit_period: 'week',
    suggested_target_sessions: null,
    suggested_freq: null,
    suggested_interval_count: null,
    sort_order: 10,
  },
  {
    id: '20000000-0000-4000-8000-000000000102',
    life_area_id: '10000000-0000-4000-8000-000000000001',
    slug: 'reach-a-weight',
    title: 'Reach a weight',
    kind: 'measured',
    suggested_measurement_unit: 'kg',
    suggested_start_value: null,
    suggested_target_value: null,
    suggested_target_count: null,
    suggested_minimum_count: null,
    suggested_habit_period: null,
    suggested_target_sessions: null,
    suggested_freq: null,
    suggested_interval_count: null,
    sort_order: 20,
  },
  {
    id: '20000000-0000-4000-8000-000000000201',
    life_area_id: '10000000-0000-4000-8000-000000000002',
    slug: 'learn-a-language',
    title: 'Learn a language',
    kind: 'scheduled',
    suggested_measurement_unit: null,
    suggested_start_value: null,
    suggested_target_value: null,
    suggested_target_count: null,
    suggested_minimum_count: null,
    suggested_habit_period: null,
    suggested_target_sessions: null,
    suggested_freq: 'weekly',
    suggested_interval_count: 1,
    sort_order: 10,
  },
];

/** The body of a valid habit goal, used wherever the test is about something else. */
const NEW_HABIT = {
  title: 'Move your body',
  kind: 'habit',
  habit: { targetCount: 3, minimumCount: 1, period: 'week' },
};

/**
 * The response body, narrowed.
 *
 * supertest types `res.body` as `any`, and reading a field off it is exactly the unchecked access
 * the project bans on anything that arrived over the wire — in the tests as much as in the app.
 * Parsing the text and running it through the same narrowing the routes use keeps that rule whole.
 */
function bodyOf(res: request.Response): UnknownRow {
  const parsed: unknown = JSON.parse(res.text === '' ? '{}' : res.text);
  return asRows([parsed])[0] ?? {};
}

function send(method: 'post' | 'patch' | 'put' | 'delete', path: string): request.Test {
  return request(createApp())[method](path).set('Authorization', `Bearer ${ACCESS_TOKEN}`);
}

beforeEach(() => {
  createClientMock.mockReset().mockReturnValue(fakeClient);
  queries.length = 0;
  rpcCalls.length = 0;
  respond = (query) => {
    if (query.table === 'goal_dashboard') return rows([HABIT_TILE_ROW]);
    if (query.table === 'life_areas') return rows(LIFE_AREA_ROWS);
    if (query.table === 'goal_templates') return rows(TEMPLATE_ROWS);
    if (query.table === 'progress_entries') return rows([MEASUREMENT_ROW]);
    return rows([{ id: GOAL_ID }]);
  };
  respondRpc = (call) => {
    switch (call.fn) {
      case 'begin_request':
        return rows([SESSION_ROW]);
      case 'complete_occurrence':
        return rows([COMPLETION_ROW]);
      case 'undo_occurrence':
        return rows([UNDO_ROW]);
      case 'log_measurement':
        return rows([MEASUREMENT_ROW]);
      case 'set_goal_layout':
        return rows([{ id: GOAL_ID, sort_order: 20, size: 'small' }]);
      default:
        return rows([RECURRENCE_ROW]);
    }
  };
  stubSupabaseEnv();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const WRITES = [
  ['create a goal', 'post', '/api/goals', NEW_HABIT],
  ['edit a goal', 'patch', `/api/goals/${GOAL_ID}`, { title: 'Swim' }],
  ['delete a goal', 'delete', `/api/goals/${GOAL_ID}`, undefined],
  ['reorder tiles', 'patch', '/api/goals/layout', { tiles: [{ id: GOAL_ID, sortOrder: 20 }] }],
  ['complete an occurrence', 'post', `/api/goals/${GOAL_ID}/completions`, {}],
  ['undo a completion', 'delete', `/api/goals/${GOAL_ID}/completions/${ENTRY_ID}`, undefined],
  ['log a measurement', 'post', `/api/goals/${GOAL_ID}/measurements`, { value: 81.6 }],
  [
    'correct a measurement',
    'patch',
    `/api/goals/${GOAL_ID}/measurements/${MEASUREMENT_ID}`,
    { value: 81.2 },
  ],
  [
    'undo a measurement',
    'delete',
    `/api/goals/${GOAL_ID}/measurements/${MEASUREMENT_ID}`,
    undefined,
  ],
  [
    'add a rule',
    'post',
    `/api/goals/${GOAL_ID}/recurrences`,
    { freq: 'weekly', byWeekday: [2, 4], startDate: '2026-09-21' },
  ],
  [
    'replace a rule',
    'put',
    `/api/goals/${GOAL_ID}/recurrences/${RULE_ID}`,
    { freq: 'daily', startDate: '2026-09-21' },
  ],
  ['delete a rule', 'delete', `/api/goals/${GOAL_ID}/recurrences/${RULE_ID}`, undefined],
] as const;

// --- Identity: every write is a session's write, charged to the write quota ---------------------

describe.each(WRITES)('%s', (_name, method, path, body) => {
  it('refuses a request with no session, without touching Supabase', async () => {
    const res = await request(createApp())[method](path).send(body);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized', reason: 'missing_token' });
    expect(createClientMock).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
    expect(queries).toHaveLength(0);
  });

  it('charges the WRITE quota, not the read one', async () => {
    await send(method, path).send(body);

    expect(rpcCalls[0]?.fn).toBe('begin_request');
    expect(rpcCalls[0]?.args).toEqual({ p_kind: 'write' });
  });

  it('acts as the caller: anon key plus their token, never the service-role key', async () => {
    await send(method, path).send(body);

    const call = createClientMock.mock.calls[0] as [
      string,
      string,
      { global?: { headers?: Record<string, string> } },
    ];
    expect(call[1]).toBe(FAKE_ANON_KEY);
    expect(call[1]).not.toBe(FAKE_SERVICE_ROLE_KEY);
    expect(call[2].global?.headers?.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it('is never cached, and never leaks anything upstream', async () => {
    const res = await send(method, path).send(body);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.vary).toContain('Authorization');
    expectNoSecrets(res.text);
  });

  it('refuses a caller over quota with 429, and writes nothing', async () => {
    respondRpc = () => rows([{ ...SESSION_ROW, retry_after_seconds: 30 }]);

    const res = await send(method, path).send(body);

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'rate_limited', retryAfterSeconds: 30 });
    expect(res.headers['retry-after']).toBe('30');
    expect(queries).toHaveLength(0);
    expect(rpcCalls).toHaveLength(1);
  });
});

// --- POST /api/goals ----------------------------------------------------------------------------

describe('POST /api/goals', () => {
  it('writes the columns the body asked for, and answers with the tile', async () => {
    const res = await send('post', '/api/goals').send({
      title: '  Move your body  ',
      description: 'Any movement counts.',
      kind: 'habit',
      size: 'large',
      lifeAreaId: '10000000-0000-4000-8000-000000000001',
      startDate: '2026-08-21',
      habit: { targetCount: 3, minimumCount: 1, period: 'week' },
    });

    expect(res.status).toBe(201);
    const insert = queries.find((query) => query.verb === 'insert');
    expect(insert?.table).toBe('goals');
    expect(insert?.payload).toEqual({
      title: 'Move your body',
      description: 'Any movement counts.',
      kind: 'habit',
      size: 'large',
      life_area_id: '10000000-0000-4000-8000-000000000001',
      start_date: '2026-08-21',
      target_count: 3,
      minimum_count: 1,
      habit_period: 'week',
      user_id: SESSION_USER_ID,
    });
    expect(res.body).toEqual({
      goal: expect.objectContaining({ id: GOAL_ID, kind: 'habit' }) as unknown,
    });
  });

  it('takes the owner from the session, whatever the body says', async () => {
    await send('post', '/api/goals').send({
      ...NEW_HABIT,
      userId: OTHER_USER_ID,
      user_id: OTHER_USER_ID,
    });

    const insert = queries.find((query) => query.verb === 'insert');
    expect(insert?.payload).toEqual(expect.objectContaining({ user_id: SESSION_USER_ID }));
    expect(JSON.stringify(insert?.payload)).not.toContain(OTHER_USER_ID);
  });

  it('never accepts a status: a new goal is active', async () => {
    await send('post', '/api/goals').send({ ...NEW_HABIT, status: 'completed' });

    const insert = queries.find((query) => query.verb === 'insert');
    expect(JSON.stringify(insert?.payload)).not.toContain('completed');
  });

  it.each([
    ['no body at all', undefined, 'invalid_request'],
    ['no title', { kind: 'habit', habit: { targetCount: 3, period: 'week' } }, 'invalid_request'],
    ['no kind', { title: 'x' }, 'invalid_request'],
    ['an unknown kind', { title: 'x', kind: 'streak' }, 'invalid_request'],
    ['no kind block', { title: 'x', kind: 'habit' }, 'invalid_request'],
    [
      'the wrong kind block',
      { title: 'x', kind: 'habit', measured: { startValue: 1, targetValue: 2 } },
      'invalid_request',
    ],
    [
      'two kind blocks',
      {
        title: 'x',
        kind: 'habit',
        habit: { targetCount: 3, period: 'week' },
        scheduled: { targetSessions: 4 },
      },
      'invalid_request',
    ],
    [
      'equal measured bounds',
      { title: 'x', kind: 'measured', measured: { startValue: 5, targetValue: 5 } },
      'invalid_request',
    ],
    ['a 201-character title', { ...NEW_HABIT, title: 'x'.repeat(201) }, 'invalid_request'],
    [
      'a colour that is not a colour',
      { ...NEW_HABIT, colorOverride: 'reddish' },
      'invalid_request',
    ],
    ['a date that does not exist', { ...NEW_HABIT, startDate: '2026-02-30' }, 'invalid_request'],
  ])('refuses %s before spending a round trip', async (_case, body, error) => {
    const res = await send('post', '/api/goals').send(body);

    expect(res.status).toBe(400);
    expect(bodyOf(res).error).toBe(error);
    expect(res.headers['cache-control']).toBe('no-store');
    // Nothing was resolved, nothing was charged, nothing was written.
    expect(createClientMock).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
    expect(queries).toHaveLength(0);
  });

  it('names the field that was wrong', async () => {
    const res = await send('post', '/api/goals').send({ ...NEW_HABIT, size: 'enormous' });

    expect(res.body).toEqual({
      error: 'invalid_request',
      message: 'size must be one of: small, medium, large.',
      field: 'size',
    });
  });
});

// --- Caps and refusals --------------------------------------------------------------------------

describe('a write the database refuses', () => {
  it('renders a cap as 409 with the cap name, and never the raw message', async () => {
    respond = () => fails('23514', 'limit_reached', 'goals_per_user');

    const res = await send('post', '/api/goals').send(NEW_HABIT);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'limit_reached', limit: 'goals_per_user' });
    expect(res.text).not.toContain('23514');
    expect(res.text).not.toContain('check constraint');
    expectNoSecrets(res.text);
  });

  it('drops a cap name it does not recognise rather than echoing it', async () => {
    respond = () => fails('23514', 'limit_reached', 'rows in some internal table');

    const res = await send('post', '/api/goals').send(NEW_HABIT);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'limit_reached' });
    expect(res.text).not.toContain('internal');
  });

  it('renders any other CHECK as 400 without naming the constraint', async () => {
    respond = () =>
      fails('23514', 'new row for relation "goals" violates check constraint "goals_kind_fields"');

    const res = await send('post', '/api/goals').send(NEW_HABIT);

    expect(res.status).toBe(400);
    expect(bodyOf(res).error).toBe('invalid_request');
    expect(res.text).not.toContain('goals_kind_fields');
    expect(res.text).not.toContain('relation');
  });

  it('renders a foreign key as 400 without saying which id or which table', async () => {
    respond = () =>
      fails(
        '23503',
        'insert or update on table "goals" violates foreign key constraint "goals_life_area_id_fkey"',
        'Key (life_area_id)=(10000000-0000-4000-8000-000000000009) is not present in table "life_areas".',
      );

    const res = await send('post', '/api/goals').send(NEW_HABIT);

    expect(res.status).toBe(400);
    expect(bodyOf(res).error).toBe('invalid_reference');
    expect(res.text).not.toContain('life_areas');
    expect(res.text).not.toContain('10000000-0000-4000-8000-000000000009');
  });

  it('renders an unrecognised failure as a 503, not as a 4xx', async () => {
    respond = () => fails('57014', 'canceling statement due to statement timeout', null, 500);

    const res = await send('post', '/api/goals').send(NEW_HABIT);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'unavailable', reason: 'upstream_error' });
    expect(res.text).not.toContain('statement timeout');
  });

  it.each([
    ['goal_not_found', 'goal'],
    ['entry_not_found', 'entry'],
    ['recurrence_not_found', 'recurrence'],
  ])('renders %s as a 404 saying only what was not found', async (token, reason) => {
    respondRpc = (call) =>
      call.fn === 'begin_request' ? rows([SESSION_ROW]) : fails('P0002', token);

    const res = await send('post', `/api/goals/${GOAL_ID}/completions`).send({});

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found', reason });
    expectNoSecrets(res.text);
  });

  it('answers 404 when an update matches no row the caller can see', async () => {
    respond = (query) => (query.verb === 'update' ? rows([]) : rows([HABIT_TILE_ROW]));

    const res = await send('patch', `/api/goals/${GOAL_ID}`).send({ title: 'Mine now' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found', reason: 'goal' });
  });
});

// --- PATCH /api/goals/:goalId -------------------------------------------------------------------

describe('PATCH /api/goals/:goalId', () => {
  it('sends only the fields that were in the body', async () => {
    const res = await send('patch', `/api/goals/${GOAL_ID}`).send({
      title: 'Swim instead',
      habit: { targetCount: 2 },
      description: null,
    });

    expect(res.status).toBe(200);
    const update = queries.find((query) => query.verb === 'update');
    expect(update?.table).toBe('goals');
    expect(update?.payload).toEqual({ title: 'Swim instead', target_count: 2, description: null });
    // The id is the only filter: goals_update is what scopes it to this caller.
    expect(update?.ops).toEqual([`eq:id=${GOAL_ID}`]);
  });

  it('archives a goal by status, and lets the database stamp the dates', async () => {
    await send('patch', `/api/goals/${GOAL_ID}`).send({ status: 'archived' });

    const update = queries.find((query) => query.verb === 'update');
    expect(update?.payload).toEqual({ status: 'archived' });
    expect(JSON.stringify(update?.payload)).not.toContain('archived_at');
  });

  it('refuses to change kind', async () => {
    const res = await send('patch', `/api/goals/${GOAL_ID}`).send({ kind: 'measured' });

    expect(res.status).toBe(400);
    expect(bodyOf(res).field).toBe('kind');
    expect(queries).toHaveLength(0);
  });

  it('refuses an empty change rather than writing nothing and reporting success', async () => {
    const res = await send('patch', `/api/goals/${GOAL_ID}`).send({});

    expect(res.status).toBe(400);
    expect(queries).toHaveLength(0);
  });

  it('refuses a path id that is not an id, without asking Supabase', async () => {
    const res = await send('patch', '/api/goals/not-a-uuid').send({ title: 'x' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'invalid_request',
      message: 'goalId must be an id.',
      field: 'goalId',
    });
    expect(createClientMock).not.toHaveBeenCalled();
  });
});

// --- DELETE /api/goals/:goalId ------------------------------------------------------------------

describe('DELETE /api/goals/:goalId', () => {
  it('deletes by id alone and answers 204', async () => {
    const res = await send('delete', `/api/goals/${GOAL_ID}`);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const remove = queries.find((query) => query.verb === 'delete');
    expect(remove?.table).toBe('goals');
    expect(remove?.ops).toEqual([`eq:id=${GOAL_ID}`]);
  });

  it("answers 404 when the goal is not the caller's, or is already gone", async () => {
    respond = () => rows([]);

    const res = await send('delete', `/api/goals/${GOAL_ID}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found', reason: 'goal' });
  });
});

// --- PATCH /api/goals/layout --------------------------------------------------------------------

describe('PATCH /api/goals/layout', () => {
  it('sends the whole batch to one statement', async () => {
    const res = await send('patch', '/api/goals/layout').send({
      tiles: [
        { id: GOAL_ID, sortOrder: 10, size: 'small' },
        { id: ENTRY_ID, sortOrder: 20 },
      ],
    });

    expect(res.status).toBe(200);
    const call = rpcCalls.find((rpc) => rpc.fn === 'set_goal_layout');
    expect(call?.args).toEqual({
      p_items: [
        { id: GOAL_ID, sort_order: 10, size: 'small' },
        { id: ENTRY_ID, sort_order: 20 },
      ],
    });
    expect(res.body).toEqual({ tiles: [{ id: GOAL_ID, sortOrder: 20, size: 'small' }] });
  });

  it('is not swallowed by the /:goalId route', async () => {
    await send('patch', '/api/goals/layout').send({ tiles: [{ id: GOAL_ID, sortOrder: 1 }] });

    expect(rpcCalls.some((rpc) => rpc.fn === 'set_goal_layout')).toBe(true);
    expect(queries.some((query) => query.verb === 'update')).toBe(false);
  });

  it("applies nothing when one tile is not the caller's", async () => {
    respondRpc = (call) =>
      call.fn === 'begin_request' ? rows([SESSION_ROW]) : fails('P0002', 'layout_mismatch');

    const res = await send('patch', '/api/goals/layout').send({
      tiles: [
        { id: GOAL_ID, sortOrder: 1 },
        { id: ENTRY_ID, sortOrder: 2 },
      ],
    });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found', reason: 'goal' });
    expect(res.text).not.toContain('layout_mismatch');
  });

  it.each([
    ['an empty batch', { tiles: [] }],
    [
      'the same tile twice',
      {
        tiles: [
          { id: GOAL_ID, sortOrder: 1 },
          { id: GOAL_ID, sortOrder: 2 },
        ],
      },
    ],
    ['a tile that changes nothing', { tiles: [{ id: GOAL_ID }] }],
    ['101 tiles', { tiles: Array.from({ length: 101 }, () => ({ id: GOAL_ID, sortOrder: 1 })) }],
    ['a size the enum does not have', { tiles: [{ id: GOAL_ID, size: 'enormous' }] }],
  ])('refuses %s', async (_case, body) => {
    const res = await send('patch', '/api/goals/layout').send(body);

    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });
});

// --- Completions --------------------------------------------------------------------------------

describe('completing an occurrence', () => {
  it('means today when the body is empty, and lets SQL decide which day that is', async () => {
    const res = await send('post', `/api/goals/${GOAL_ID}/completions`).send({});

    expect(res.status).toBe(200);
    const call = rpcCalls.find((rpc) => rpc.fn === 'complete_occurrence');
    expect(call?.args).toEqual({ p_goal_id: GOAL_ID, p_on: null, p_entry_id: null });
    expect(res.body).toEqual({
      created: true,
      entry: {
        id: ENTRY_ID,
        date: '2026-09-18',
        timeZone: 'UTC',
        title: 'Move your body',
        notes: null,
        status: 'completed',
        completedAt: '2026-09-18T03:22:10.101Z',
        recurrenceId: null,
        goal: {
          id: GOAL_ID,
          title: 'Move your body',
          kind: 'habit',
          color: '#2e7d57',
          area: {
            id: '10000000-0000-4000-8000-000000000001',
            slug: 'health',
            name: 'Health & Wellbeing',
            icon: 'heart',
          },
        },
        timing: 'untimed',
        startAt: null,
        endAt: null,
      },
      goal: expect.objectContaining({
        id: GOAL_ID,
        progress: { basis: 'period_completion', fraction: 0.3333 },
      }) as unknown,
    });
  });

  it('works with no body at all, which is what a tile tap sends', async () => {
    const res = await send('post', `/api/goals/${GOAL_ID}/completions`);

    expect(res.status).toBe(200);
    expect(rpcCalls.some((rpc) => rpc.fn === 'complete_occurrence')).toBe(true);
  });

  it('passes a day and an occurrence through when the caller names them', async () => {
    await send('post', `/api/goals/${GOAL_ID}/completions`).send({
      date: '2026-09-17',
      entryId: ENTRY_ID,
    });

    expect(rpcCalls.find((rpc) => rpc.fn === 'complete_occurrence')?.args).toEqual({
      p_goal_id: GOAL_ID,
      p_on: '2026-09-17',
      p_entry_id: ENTRY_ID,
    });
  });

  it('reports created: false when the day was already completed', async () => {
    respondRpc = (call) =>
      call.fn === 'begin_request'
        ? rows([SESSION_ROW])
        : rows([{ ...COMPLETION_ROW, created: false, created_by_completion: false }]);

    const res = await send('post', `/api/goals/${GOAL_ID}/completions`).send({});

    expect(bodyOf(res).created).toBe(false);
  });

  it('refuses a date that is not a date', async () => {
    const res = await send('post', `/api/goals/${GOAL_ID}/completions`).send({ date: 'today' });

    expect(res.status).toBe(400);
    expect(bodyOf(res).field).toBe('date');
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('undoing a completion', () => {
  it('says which of the two things it did, and returns the tile with it', async () => {
    const res = await send('delete', `/api/goals/${GOAL_ID}/completions/${ENTRY_ID}`);

    expect(res.status).toBe(200);
    expect(rpcCalls.find((rpc) => rpc.fn === 'undo_occurrence')?.args).toEqual({
      p_goal_id: GOAL_ID,
      p_entry_id: ENTRY_ID,
    });
    expect(bodyOf(res)).toEqual(
      expect.objectContaining({
        action: 'deleted',
        entry: expect.objectContaining({ id: ENTRY_ID }) as unknown,
        goal: expect.objectContaining({ id: GOAL_ID }) as unknown,
      }),
    );
  });

  it('reports a retried undo as noop rather than as an error', async () => {
    respondRpc = (call) =>
      call.fn === 'begin_request'
        ? rows([SESSION_ROW])
        : rows([{ ...UNDO_ROW, action: 'noop', status: 'planned', completed_at: null }]);

    const res = await send('delete', `/api/goals/${GOAL_ID}/completions/${ENTRY_ID}`);

    expect(res.status).toBe(200);
    expect(bodyOf(res)).toEqual(
      expect.objectContaining({
        action: 'noop',
        entry: expect.objectContaining({ status: 'planned' }) as unknown,
      }),
    );
  });
});

// --- Measurements -------------------------------------------------------------------------------

describe('measurements', () => {
  it('logs a value, and answers with the check-in and the tile', async () => {
    const res = await send('post', `/api/goals/${GOAL_ID}/measurements`).send({
      value: 81.6,
      note: '  After the trip.  ',
    });

    expect(res.status).toBe(200);
    expect(rpcCalls.find((rpc) => rpc.fn === 'log_measurement')?.args).toEqual({
      p_goal_id: GOAL_ID,
      p_value: 81.6,
      p_occurred_on: null,
      p_note: 'After the trip.',
    });
    expect(bodyOf(res).measurement).toEqual({
      id: MEASUREMENT_ID,
      goalId: GOAL_ID,
      occurredOn: '2026-09-18',
      value: 81.6,
      note: 'After the trip.',
      calendarEntryId: null,
      createdAt: '2026-09-18T03:25:00.000Z',
      updatedAt: '2026-09-18T03:25:00.000Z',
    });
    expect(bodyOf(res).goal).toEqual(expect.objectContaining({ id: GOAL_ID }));
  });

  it('renders a check-in against the wrong kind of goal as a 409', async () => {
    respondRpc = (call) =>
      call.fn === 'begin_request' ? rows([SESSION_ROW]) : fails('22023', 'wrong_goal_kind');

    const res = await send('post', `/api/goals/${GOAL_ID}/measurements`).send({ value: 5 });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'conflict', reason: 'wrong_goal_kind' });
  });

  it('corrects one by id, scoped to the goal in the path', async () => {
    const res = await send('patch', `/api/goals/${GOAL_ID}/measurements/${MEASUREMENT_ID}`).send({
      value: 81.2,
      note: null,
    });

    expect(res.status).toBe(200);
    const update = queries.find((query) => query.verb === 'update');
    expect(update?.table).toBe('progress_entries');
    expect(update?.payload).toEqual({ value: 81.2, note: null });
    expect(update?.ops).toEqual([`eq:id=${MEASUREMENT_ID}`, `eq:goal_id=${GOAL_ID}`]);
  });

  it('undoes one by deleting it, and answers with the tile that changed', async () => {
    respond = (query) =>
      query.table === 'goal_dashboard' ? rows([HABIT_TILE_ROW]) : rows([{ id: MEASUREMENT_ID }]);

    const res = await send('delete', `/api/goals/${GOAL_ID}/measurements/${MEASUREMENT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ goal: expect.objectContaining({ id: GOAL_ID }) as unknown });
    const remove = queries.find((query) => query.verb === 'delete');
    expect(remove?.ops).toEqual([`eq:id=${MEASUREMENT_ID}`, `eq:goal_id=${GOAL_ID}`]);
  });

  it('refuses a value that is not a number', async () => {
    const res = await send('post', `/api/goals/${GOAL_ID}/measurements`).send({ value: '81.6' });

    expect(res.status).toBe(400);
    expect(bodyOf(res).field).toBe('value');
    expect(rpcCalls).toHaveLength(0);
  });
});

// --- Recurrences --------------------------------------------------------------------------------

describe('recurrences', () => {
  it('creates a rule and reports what it materialised', async () => {
    const res = await send('post', `/api/goals/${GOAL_ID}/recurrences`).send({
      freq: 'weekly',
      byWeekday: [4, 2, 2],
      startDate: '2026-09-21',
      startTime: '19:00',
      endTime: '20:00',
      timeZone: 'Europe/Madrid',
    });

    expect(res.status).toBe(201);
    expect(rpcCalls.find((rpc) => rpc.fn === 'create_recurrence')?.args).toEqual({
      p_goal_id: GOAL_ID,
      p_freq: 'weekly',
      p_start_date: '2026-09-21',
      p_interval_count: 1,
      // Deduplicated and sorted, so two ways of writing one rule look the same.
      p_byweekday: [2, 4],
      p_until_date: null,
      p_start_time: '19:00:00',
      p_end_time: '20:00:00',
      p_time_zone: 'Europe/Madrid',
    });
    expect(res.body).toEqual({
      recurrence: {
        id: RULE_ID,
        goalId: GOAL_ID,
        freq: 'weekly',
        interval: 1,
        byWeekday: [2, 4],
        startDate: '2026-09-21',
        untilDate: null,
        startTime: '19:00:00',
        endTime: '20:00:00',
        timeZone: 'Europe/Madrid',
        generatedThrough: '2026-12-17',
        isActive: true,
        createdAt: '2026-09-18T03:30:00.000Z',
        updatedAt: '2026-09-18T03:30:00.000Z',
      },
      occurrences: { removed: 0, created: 26 },
    });
  });

  it('replaces a rule whole, and says how much of the plan moved', async () => {
    respondRpc = (call) =>
      call.fn === 'begin_request'
        ? rows([SESSION_ROW])
        : rows([{ ...RECURRENCE_ROW, occurrences_removed: 25, occurrences_created: 38 }]);

    const res = await send('put', `/api/goals/${GOAL_ID}/recurrences/${RULE_ID}`).send({
      freq: 'weekly',
      byWeekday: [1, 3, 5],
      startDate: '2026-08-21',
      isActive: true,
    });

    expect(res.status).toBe(200);
    expect(rpcCalls.find((rpc) => rpc.fn === 'update_recurrence')?.args).toEqual(
      expect.objectContaining({
        p_goal_id: GOAL_ID,
        p_recurrence_id: RULE_ID,
        p_byweekday: [1, 3, 5],
        p_is_active: true,
      }),
    );
    expect(bodyOf(res).occurrences).toEqual({ removed: 25, created: 38 });
  });

  it('deletes a rule and reports the history it kept', async () => {
    respondRpc = (call) =>
      call.fn === 'begin_request'
        ? rows([SESSION_ROW])
        : rows([{ id: RULE_ID, occurrences_removed: 25, occurrences_kept: 22 }]);

    const res = await send('delete', `/api/goals/${GOAL_ID}/recurrences/${RULE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: RULE_ID, occurrences: { removed: 25, kept: 22 } });
  });

  it.each([
    ['a weekly rule with no weekdays', { freq: 'weekly', startDate: '2026-09-21' }, 'byWeekday'],
    [
      'weekdays on a daily rule',
      { freq: 'daily', startDate: '2026-09-21', byWeekday: [2] },
      'byWeekday',
    ],
    [
      'a start time with no end time',
      { freq: 'daily', startDate: '2026-09-21', startTime: '19:00' },
      'endTime',
    ],
    [
      'a session that ends before it starts',
      { freq: 'daily', startDate: '2026-09-21', startTime: '19:00', endTime: '18:00' },
      'endTime',
    ],
    [
      'an end date before the start',
      { freq: 'daily', startDate: '2026-09-21', untilDate: '2026-09-01' },
      'untilDate',
    ],
    [
      'a weekday that is not one',
      { freq: 'weekly', startDate: '2026-09-21', byWeekday: [9] },
      'byWeekday',
    ],
  ])('refuses %s', async (_case, body, field) => {
    const res = await send('post', `/api/goals/${GOAL_ID}/recurrences`).send(body);

    expect(res.status).toBe(400);
    expect(bodyOf(res).field).toBe(field);
    expect(rpcCalls).toHaveLength(0);
  });
});

// --- GET /api/goal-templates --------------------------------------------------------------------

describe('GET /api/goal-templates', () => {
  function getTemplates(): request.Test {
    return request(createApp())
      .get('/api/goal-templates')
      .set('Authorization', `Bearer ${ACCESS_TOKEN}`);
  }

  it('groups the catalogue by area, discriminated the way a tile is', async () => {
    const res = await getTemplates();

    expect(res.status).toBe(200);
    expect(bodyOf(res).areas).toEqual([
      {
        area: expect.objectContaining({ slug: 'health', color: '#2e7d57' }) as unknown,
        templates: [
          {
            id: '20000000-0000-4000-8000-000000000101',
            slug: 'move-your-body',
            title: 'Move your body',
            areaId: '10000000-0000-4000-8000-000000000001',
            sortOrder: 10,
            repeat: null,
            kind: 'habit',
            habit: { targetCount: 3, minimumCount: 1, period: 'week' },
          },
          {
            id: '20000000-0000-4000-8000-000000000102',
            slug: 'reach-a-weight',
            title: 'Reach a weight',
            areaId: '10000000-0000-4000-8000-000000000001',
            sortOrder: 20,
            repeat: null,
            kind: 'measured',
            // Null, not zero: the person supplies the numbers.
            measured: { unit: 'kg', startValue: null, targetValue: null },
          },
        ],
      },
      {
        area: expect.objectContaining({ slug: 'learning' }) as unknown,
        templates: [
          expect.objectContaining({
            kind: 'scheduled',
            scheduled: { targetSessions: null },
            repeat: { freq: 'weekly', interval: 1 },
          }) as unknown,
        ],
      },
    ]);
  });

  it('offers a custom goal, in every area, without a row for it', async () => {
    const res = await getTemplates();

    expect(bodyOf(res).custom).toEqual({
      kinds: ['scheduled', 'measured', 'habit'],
      defaultSize: 'medium',
    });
    expect(res.text).not.toContain('Something else');
  });

  it('returns an area with no templates rather than dropping it', async () => {
    respond = (query) =>
      query.table === 'life_areas' ? rows(LIFE_AREA_ROWS) : rows([TEMPLATE_ROWS[0]]);

    const res = await getTemplates();

    expect(bodyOf(res).areas).toEqual([
      expect.objectContaining({ templates: [expect.objectContaining({ slug: 'move-your-body' })] }),
      expect.objectContaining({ templates: [] }),
    ]);
  });

  it('is read-only, and cached like every other per-caller response', async () => {
    const res = await getTemplates();

    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers.vary).toContain('Authorization');
    const templates = queries.find((query) => query.table === 'goal_templates');
    expect(templates?.verb).toBe('select');
    // No is_active filter: goal_templates_select is what hides a retired row.
    expect(templates?.ops).toEqual(['order:sort_order:asc', 'order:title:asc']);
  });

  it('needs a session, like every other /api route', async () => {
    const res = await request(createApp()).get('/api/goal-templates');

    expect(res.status).toBe(401);
    expect(createClientMock).not.toHaveBeenCalled();
  });
});

// --- GET /api/goals, now that a goal can be finished --------------------------------------------

describe('GET /api/goals', () => {
  it('still asks for active goals when nothing is requested', async () => {
    const res = await request(createApp())
      .get('/api/goals')
      .set('Authorization', `Bearer ${ACCESS_TOKEN}`);

    expect(res.status).toBe(200);
    expect(queries[0]?.ops).toContain('eq:status=active');
    expect(rpcCalls[0]?.args).toEqual({ p_kind: 'read' });
  });

  it('serves the shelf a finished goal moves to', async () => {
    const res = await request(createApp())
      .get('/api/goals?status=completed,archived')
      .set('Authorization', `Bearer ${ACCESS_TOKEN}`);

    expect(res.status).toBe(200);
    expect(queries[0]?.ops).toContain('in:status=completed|archived');
  });

  it('refuses a status it does not have', async () => {
    const res = await request(createApp())
      .get('/api/goals?status=finished')
      .set('Authorization', `Bearer ${ACCESS_TOKEN}`);

    expect(res.status).toBe(400);
    expect(bodyOf(res).field).toBe('status');
    expect(createClientMock).not.toHaveBeenCalled();
  });
});
