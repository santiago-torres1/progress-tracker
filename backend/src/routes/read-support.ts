import type { Request, Response } from 'express';

import { toReadUnavailable } from '../lib/read.js';
import {
  RateLimitedError,
  readBearerToken,
  resolveSession,
  UnauthorizedError,
  type RequestKind,
  type Session,
} from '../lib/session.js';
import type { ApiErrorResponse, AuthReason } from '../types/api.js';

/**
 * Cache policy for every successful /api response.
 *
 * v0.1.1-alpha served the same eight goals to everyone and was `public, max-age=60`. That was
 * true exactly because there was no login, and the comment there said this constant had to
 * change in the same release that added auth. This is that change: every response now depends
 * on the caller's token, so a shared cache holding one must never hand it to anyone else.
 *
 * `no-store` rather than `private, max-age=…`: the payloads are small, the alternative saves one
 * round trip per navigation, and getting it wrong shows one visitor another's goals. The routes
 * also send `Vary: Authorization`, which is belt and braces for anything between here and the
 * browser that ignores `private`.
 */
export const READ_CACHE_CONTROL = 'private, no-store';

/** Rejects a malformed request. The message describes the input, never anything upstream. */
export function respondBadRequest(res: Response, error: string, message: string): void {
  const body: ApiErrorResponse = { error, message };
  res.status(400).set('Cache-Control', 'no-store').json(body);
}

/**
 * Refuses a caller we could not identify.
 *
 * A short reason code and nothing else: no upstream message, no token, no id, and no hint about
 * whether the subject exists. `missing_token` and `malformed_token` describe the request (the
 * caller can fix those); `invalid_token` and `no_profile` deliberately do not distinguish
 * "expired", "forged" or "unknown".
 */
export function respondUnauthorized(res: Response, reason: AuthReason): void {
  const body: ApiErrorResponse = { error: 'unauthorized', reason };
  res.status(401).set('Cache-Control', 'no-store').json(body);
}

/** Refuses a caller who is over quota, and says when to come back. */
export function respondRateLimited(res: Response, retryAfterSeconds: number): void {
  const body: ApiErrorResponse = { error: 'rate_limited', retryAfterSeconds };
  res
    .status(429)
    .set('Cache-Control', 'no-store')
    .set('Retry-After', String(retryAfterSeconds))
    .json(body);
}

/**
 * Renders any read failure as a 503 with a short reason code.
 *
 * Always `no-store`: a cache entry for "Supabase is down" would outlive the outage and make
 * recovery look slower than it is.
 */
export function respondUnavailable(res: Response, error: unknown, context: string): void {
  const unavailable = toReadUnavailable(error, context);
  const body: ApiErrorResponse = { error: 'unavailable', reason: unavailable.reason };
  if (unavailable.missing !== undefined) body.missing = unavailable.missing;
  res.status(503).set('Cache-Control', 'no-store').json(body);
}

export interface SessionOptions {
  /** Upper bound on each Supabase round-trip. Overridable for tests. */
  readTimeoutMs?: number;
  /** Which quota to charge. Phase 2's write routes pass 'write'. */
  kind?: RequestKind;
}

/**
 * The session for this request, or `undefined` once a 401 / 429 / 503 has already been sent.
 *
 * A plain function rather than middleware, for two reasons. It returns a typed Session instead
 * of smuggling one through `res.locals`, which is `any` and would need a cast at every use — and
 * `no as casts on anything that arrived over the wire` is a project rule. And it lets a route
 * put free work first: GET /api/calendar validates its date range before calling this, so a
 * malformed request is rejected without ever touching Supabase.
 */
export async function requireSession(
  req: Request,
  res: Response,
  context: string,
  options: SessionOptions = {},
): Promise<Session | undefined> {
  try {
    const token = readBearerToken(req.header('authorization'));
    return await resolveSession(token, options.kind ?? 'read', options.readTimeoutMs);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      respondUnauthorized(res, error.reason);
      return undefined;
    }
    if (error instanceof RateLimitedError) {
      respondRateLimited(res, error.retryAfterSeconds);
      return undefined;
    }
    respondUnavailable(res, error, context);
    return undefined;
  }
}
