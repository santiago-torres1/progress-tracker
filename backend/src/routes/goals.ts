import { Router } from 'express';

import { READ_CACHE_CONTROL, respondUnavailable } from './read-support.js';
import { fetchActiveGoals } from '../lib/goal-dashboard.js';
import type { GoalsResponse } from '../types/api.js';

export interface GoalsRouterOptions {
  /** Upper bound on the Supabase round-trip. Overridable for tests. */
  readTimeoutMs?: number;
}

/** GET /api/goals — one entry per active goal, in canvas order. Read-only; there is no write path. */
export function createGoalsRouter(options: GoalsRouterOptions = {}): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const goals = await fetchActiveGoals(options.readTimeoutMs);
      const body: GoalsResponse = { goals };
      res.set('Cache-Control', READ_CACHE_CONTROL).json(body);
    } catch (error) {
      respondUnavailable(res, error, '[api/goals]');
    }
  });

  return router;
}
