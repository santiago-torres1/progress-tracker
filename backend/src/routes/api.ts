import { Router } from 'express';

import { createAreasRouter } from './areas.js';
import { createCalendarRouter } from './calendar.js';
import { createGoalsRouter } from './goals.js';

export interface ApiRouterOptions {
  /** Upper bound on each Supabase round-trip, for every /api route. Overridable for tests. */
  readTimeoutMs?: number;
}

/**
 * The read-only API for v0.1.1-alpha.
 *
 * Three GETs and nothing else: the demo renders real Supabase rows and writes nothing. Writes
 * arrive in v0.1.2 with Supabase Auth, at which point these routes move off the service-role
 * key and onto the caller's access token.
 */
export function createApiRouter(options: ApiRouterOptions = {}): Router {
  const router = Router();

  router.use('/goals', createGoalsRouter(options));
  router.use('/calendar', createCalendarRouter(options));
  router.use('/areas', createAreasRouter(options));

  return router;
}
