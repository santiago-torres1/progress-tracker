import { Router } from 'express';

import { createAreasRouter } from './areas.js';
import { createCalendarRouter } from './calendar.js';
import { createGoalTemplatesRouter } from './goal-templates.js';
import { createGoalsRouter } from './goals.js';
import type { SessionOptions } from './read-support.js';
import { createSessionRouter } from './session.js';

export type ApiRouterOptions = SessionOptions;

/**
 * The product API for v0.2.0-alpha.
 *
 * Every route requires `Authorization: Bearer <supabase access token>` and is served by a client
 * acting as that user, so row-level security decides what comes back and what may be written.
 * /health is unaffected and stays anonymous.
 *
 * Reads are charged against the read quota and writes against the write one (see lib/session.ts);
 * no route anywhere below takes an owner from a request body.
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
  // Reference data, like /areas: the catalogue a new goal can start from. Nothing that writes a
  // goal ever mentions it — see routes/goal-templates.ts.
  router.use('/goal-templates', createGoalTemplatesRouter(options));
  // The caller's own preferences. It decides what "today" means for every route above it, which
  // is why it is part of the product API rather than a setting hidden in the client.
  router.use('/session', createSessionRouter(options));

  return router;
}
