import { Router } from 'express';

import {
  READ_CACHE_CONTROL,
  requireSession,
  respondUnavailable,
  type SessionOptions,
} from './read-support.js';
import { fetchActiveGoals } from '../lib/goal-dashboard.js';
import type { GoalsResponse } from '../types/api.js';

export type GoalsRouterOptions = SessionOptions;

const CONTEXT = '[api/goals]';

/**
 * GET /api/goals — one entry per active goal, in canvas order.
 *
 * Returns the caller's own goals and no one else's, and that is enforced by the goals_select
 * policy rather than by anything here: the query names no user. A new visitor's board is empty,
 * which is the milestone's intent.
 */
export function createGoalsRouter(options: GoalsRouterOptions = {}): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const session = await requireSession(req, res, CONTEXT, options);
    if (session === undefined) return;

    try {
      const goals = await fetchActiveGoals(session.client, options.readTimeoutMs);
      const body: GoalsResponse = { goals };
      res.set('Cache-Control', READ_CACHE_CONTROL).json(body);
    } catch (error) {
      respondUnavailable(res, error, CONTEXT);
    }
  });

  return router;
}
