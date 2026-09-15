import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { errorHandler, notFoundHandler } from './errors.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('errorHandler', () => {
  it('returns a JSON 500 with no message or stack trace', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express()
      .get('/boom', () => {
        throw new Error('sensitive internal detail');
      })
      .use(notFoundHandler)
      .use(errorHandler);

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: 'internal_server_error' });
    expect(res.text).not.toContain('sensitive internal detail');
    expect(res.text).not.toContain('errors.test.ts');
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it('handles rejected promises from async handlers (Express 5)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express()
      .get('/async-boom', async () => {
        await Promise.resolve();
        throw new Error('async failure');
      })
      .use(errorHandler);

    const res = await request(app).get('/async-boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal_server_error' });
  });
});
