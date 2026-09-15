import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import type { SupabaseAdminClient } from '../lib/supabase.js';

// Never talk to a real Supabase project: replace only createClient, keep the real error classes.
const { createClientMock, listUsersMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  listUsersMock: vi.fn(),
}));

vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@supabase/supabase-js')>()),
  createClient: createClientMock,
}));

const FAKE_URL = 'https://fake-project-ref.supabase.co';
const FAKE_ANON_KEY = 'fake-anon-key-do-not-echo';
const FAKE_SERVICE_ROLE_KEY = 'fake-service-role-key-do-not-echo';

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
  for (const secret of [FAKE_URL, 'fake-project-ref', FAKE_ANON_KEY, FAKE_SERVICE_ROLE_KEY]) {
    expect(text).not.toContain(secret);
  }
}

const fakeClient = {
  auth: { admin: { listUsers: listUsersMock } },
} as unknown as SupabaseAdminClient;

beforeEach(() => {
  createClientMock.mockReset().mockReturnValue(fakeClient);
  listUsersMock.mockReset().mockResolvedValue({ data: { users: [] }, error: null });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /health/db when Supabase is not configured', () => {
  it('reports unconfigured with HTTP 200 and never builds a client', async () => {
    stubSupabaseEnv({
      SUPABASE_URL: undefined,
      SUPABASE_ANON_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    });

    const res = await request(createApp()).get('/health/db');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      status: 'unconfigured',
      configured: false,
      reason: 'missing_env',
      missing: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
      timestamp: expect.any(String) as unknown,
    });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('lists only the missing variables and treats empty values as missing', async () => {
    stubSupabaseEnv({ SUPABASE_SERVICE_ROLE_KEY: '' });

    const res = await request(createApp()).get('/health/db');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'unconfigured',
      configured: false,
      missing: ['SUPABASE_SERVICE_ROLE_KEY'],
    });
    expectNoSecrets(res.text);
  });
});

describe('GET /health/db when Supabase is configured', () => {
  it('reports ok after a successful admin round-trip with the service-role key', async () => {
    stubSupabaseEnv();

    const res = await request(createApp()).get('/health/db');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      configured: true,
      latencyMs: expect.any(Number) as unknown,
      timestamp: expect.any(String) as unknown,
    });
    expect(createClientMock).toHaveBeenCalledWith(
      FAKE_URL,
      FAKE_SERVICE_ROLE_KEY,
      expect.anything(),
    );
    expect(listUsersMock).toHaveBeenCalledWith({ page: 1, perPage: 1 });
    expectNoSecrets(res.text);
  });

  it('reuses one client across requests', async () => {
    stubSupabaseEnv({ SUPABASE_URL: 'https://reuse-check.supabase.co' });
    const app = createApp();

    await request(app).get('/health/db');
    await request(app).get('/health/db');

    expect(createClientMock).toHaveBeenCalledOnce();
    expect(listUsersMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: 'a rejected key (401)',
      result: { data: { users: [] }, error: new AuthApiError('Invalid API key', 401, undefined) },
      reason: 'key_rejected',
    },
    {
      name: 'a non-admin key (403)',
      result: {
        data: { users: [] },
        error: new AuthApiError('User not allowed', 403, 'not_admin'),
      },
      reason: 'key_rejected',
    },
    {
      name: 'a network failure',
      result: { data: { users: [] }, error: new AuthRetryableFetchError('fetch failed', 0) },
      reason: 'unreachable',
    },
    {
      name: 'a 5xx from Supabase',
      result: { data: { users: [] }, error: new AuthRetryableFetchError('Bad Gateway', 502) },
      reason: 'upstream_unavailable',
    },
    {
      name: 'an unexpected API error',
      result: { data: { users: [] }, error: new AuthApiError('Teapot', 418, undefined) },
      reason: 'upstream_error',
    },
  ])('maps $name to 503 with reason "$reason" and no upstream message', async (testCase) => {
    stubSupabaseEnv();
    listUsersMock.mockResolvedValue(testCase.result);

    const res = await request(createApp()).get('/health/db');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'error',
      configured: true,
      reason: testCase.reason,
      latencyMs: expect.any(Number) as unknown,
      timestamp: expect.any(String) as unknown,
    });
    expect(res.text).not.toContain(testCase.result.error.message);
    expectNoSecrets(res.text);
    expect(console.error).toHaveBeenCalled();
  });

  it('maps an unexpected thrown error to probe_failed', async () => {
    stubSupabaseEnv();
    listUsersMock.mockRejectedValue(new Error(`boom ${FAKE_URL}`));

    const res = await request(createApp()).get('/health/db');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'error', reason: 'probe_failed' });
    expectNoSecrets(res.text);
  });

  it('gives up after the probe timeout instead of hanging', async () => {
    stubSupabaseEnv();
    listUsersMock.mockReturnValue(new Promise(() => undefined));

    const res = await request(createApp({ dbProbeTimeoutMs: 25 })).get('/health/db');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'error', configured: true, reason: 'timeout' });
  });

  it('reports invalid_config when the client cannot be built from the env vars', async () => {
    stubSupabaseEnv({ SUPABASE_URL: 'not-a-url' });
    createClientMock.mockImplementation(() => {
      throw new Error('Invalid supabaseUrl: not-a-url');
    });

    const res = await request(createApp()).get('/health/db');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'error', configured: true, reason: 'invalid_config' });
    expect(res.text).not.toContain('not-a-url');
  });
});
