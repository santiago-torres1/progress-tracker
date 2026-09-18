import { Router } from 'express';

import { createAreasRouter } from './areas.js';
import { createCalendarRouter } from './calendar.js';
import { createGoalsRouter } from './goals.js';
import type { SessionOptions } from './read-support.js';

export type ApiRouterOptions = SessionOptions;

/**
 * The product API for v0.2.0-alpha.
 *
 * Still three GETs — the write routes are Phase 2 — but every one of them now requires
 * `Authorization: Bearer <supabase access token>` and is served by a client acting as that user,
 * so row-level security decides what comes back. /health is unaffected and stays anonymous.
 */
export function createApiRouter(options: ApiRouterOptions = {}): Router {
  const router = Router();

  // Every response here depends on the caller's token. `Vary` says so to anything in between
  // that might otherwise reuse one visitor's response for another; the routes also send
  // `Cache-Control: private, no-store`, and this is the belt to that pair of braces.
  router.use((_req, res, next) => {
    res.set('Vary', 'Authorization');
    next();
  });

  router.use('/goals', createGoalsRouter(options));
  router.use('/calendar', createCalendarRouter(options));
  router.use('/areas', createAreasRouter(options));

  return router;
}
