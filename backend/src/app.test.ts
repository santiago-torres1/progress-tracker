import { readFileSync } from 'node:fs';

import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';

function packageVersion(): unknown {
  const pkg: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  return typeof pkg === 'object' && pkg !== null && 'version' in pkg ? pkg.version : undefined;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /health', () => {
  it('reports ok with version, commit, and timestamp', async () => {
    vi.stubEnv('GIT_SHA', undefined);

    const res = await request(createApp()).get('/health');

    // Version must come from backend/package.json, whatever it currently is.
    expect(packageVersion()).toEqual(expect.any(String));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({
      status: 'ok',
      version: packageVersion(),
      commit: 'local',
      timestamp: expect.any(String) as unknown,
    });
    const { timestamp } = res.body as { timestamp: string };
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
  });

  it('reports the commit from GIT_SHA when set', async () => {
    vi.stubEnv('GIT_SHA', 'abc1234');

    const res = await request(createApp()).get('/health');

    expect((res.body as { commit: unknown }).commit).toBe('abc1234');
  });

  it('treats an empty GIT_SHA as unset', async () => {
    vi.stubEnv('GIT_SHA', '');

    const res = await request(createApp()).get('/health');

    expect((res.body as { commit: unknown }).commit).toBe('local');
  });

  it('is not cacheable and does not advertise Express', async () => {
    const res = await request(createApp()).get('/health');

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('adds no CORS headers (the Function URL owns CORS)', async () => {
    const res = await request(createApp()).get('/health').set('Origin', 'https://example.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('unknown routes and errors', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(createApp()).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('returns a JSON 400, without parser details, for malformed JSON bodies', async () => {
    const res = await request(createApp())
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"not": json');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad_request' });
  });
});
