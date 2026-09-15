import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handler } from './lambda.js';
import { APP_VERSION } from './lib/version.js';

// The same Function URL (payload v2.0) event used against the Lambda Runtime Interface Emulator.
const healthEvent: unknown = JSON.parse(
  readFileSync(new URL('../events/function-url-health.json', import.meta.url), 'utf8'),
);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Lambda handler', () => {
  it('serves GET /health from a Function URL event through serverless-http', async () => {
    vi.stubEnv('GIT_SHA', 'lambda-test-sha');

    const result = (await handler(healthEvent as object, {})) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toMatch(/^application\/json/);
    expect(JSON.parse(result.body)).toMatchObject({
      status: 'ok',
      version: APP_VERSION,
      commit: 'lambda-test-sha',
    });
  });
});
