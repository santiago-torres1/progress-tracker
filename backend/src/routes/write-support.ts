import type { Response } from 'express';

import { respondUnavailable } from './read-support.js';
import { InvalidRequestError } from '../lib/validate.js';
import { WriteRejectedError } from '../lib/write.js';
import type { ApiErrorResponse } from '../types/api.js';

/**
 * Cache policy for every write response.
 *
 * `no-store` rather than the read path's `private, no-store`: there is nothing here a shared
 * cache could reuse for anyone, and a 201 that some intermediary decided to remember would be
 * the same goal appearing twice.
 */
export const WRITE_CACHE_CONTROL = 'no-store';

/**
 * Sends a successful write.
 *
 * Every write answers with the thing it changed — the recomputed tile, the occurrence, the rule —
 * so a client never has to refetch the board to see a glass move. `body` is `unknown` rather than
 * generic because each caller has already given it the response type from types/api.ts; a type
 * parameter used once would only restate that.
 */
export function respondWritten(res: Response, status: number, body: unknown): void {
  res.status(status).set('Cache-Control', WRITE_CACHE_CONTROL).json(body);
}

/** 204, for a delete with nothing left to report. */
export function respondDeleted(res: Response): void {
  res.status(204).set('Cache-Control', WRITE_CACHE_CONTROL).end();
}

/**
 * Renders a body or path the API will not act on.
 *
 * The message describes the request and names the field, because the caller can fix both. It is
 * built from the contract in types/api.ts, never from anything the caller sent back to them and
 * never from anything upstream.
 */
export function respondInvalid(res: Response, error: InvalidRequestError): void {
  const body: ApiErrorResponse = { error: 'invalid_request', message: error.message };
  if (error.field !== undefined) body.field = error.field;
  res.status(400).set('Cache-Control', 'no-store').json(body);
}

/**
 * Runs a parser and answers 400 if it refuses.
 *
 * Parsing happens BEFORE the session is resolved, exactly as GET /api/calendar validates its
 * range first: validation is free, resolving a session is a network round trip, and a malformed
 * body should not be able to make us spend one — or to charge the caller's write quota for it.
 */
export function parseOrReject<T>(res: Response, parse: () => T): T | undefined {
  try {
    return parse();
  } catch (error) {
    if (error instanceof InvalidRequestError) {
      respondInvalid(res, error);
      return undefined;
    }
    throw error;
  }
}

/**
 * Renders any write failure.
 *
 * A WriteRejectedError already carries the status and the body lib/write.ts decided on — a cap
 * (409 with the cap's name), a row that is not the caller's (404 saying only what was not found),
 * a conflict. Anything else is not the caller's problem and goes down the read path's 503 route,
 * which logs the detail and returns a short reason code.
 */
export function respondWriteFailure(res: Response, error: unknown, context: string): void {
  if (error instanceof InvalidRequestError) {
    respondInvalid(res, error);
    return;
  }
  if (error instanceof WriteRejectedError) {
    res.status(error.status).set('Cache-Control', 'no-store').json(error.body);
    return;
  }
  respondUnavailable(res, error, context);
}
