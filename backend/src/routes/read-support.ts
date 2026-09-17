import type { Response } from 'express';

import { toReadUnavailable } from '../lib/read.js';
import type { ApiErrorResponse } from '../types/api.js';

/**
 * Cache policy for every successful read.
 *
 * v0.1.1-alpha is a read-only demo: the same eight goals and the same calendar for every
 * visitor, and nothing in the app writes. Sixty seconds is chosen so CloudFront and the browser
 * absorb repeat traffic and a burst of visitors costs one Lambda invocation rather than
 * hundreds — while staying short enough that re-running seed.sql (which is how the demo is
 * refreshed) shows up almost immediately. `public` is safe precisely because there is no login:
 * no response here varies by caller, so there is nothing to leak into a shared cache. That
 * stops being true the moment v0.1.2 adds auth, and this constant must become `private,
 * no-store` in the same change.
 */
export const READ_CACHE_CONTROL = 'public, max-age=60';

/** Rejects a malformed request. The message describes the input, never anything upstream. */
export function respondBadRequest(res: Response, error: string, message: string): void {
  const body: ApiErrorResponse = { error, message };
  res.status(400).set('Cache-Control', 'no-store').json(body);
}

/**
 * Renders any read failure as a 503 with a short reason code.
 *
 * Always `no-store`: a 60-second cache entry for "Supabase is down" would outlive the outage
 * and make recovery look slower than it is.
 */
export function respondUnavailable(res: Response, error: unknown, context: string): void {
  const unavailable = toReadUnavailable(error, context);
  const body: ApiErrorResponse = { error: 'unavailable', reason: unavailable.reason };
  if (unavailable.missing !== undefined) body.missing = unavailable.missing;
  res.status(503).set('Cache-Control', 'no-store').json(body);
}
