import { Router } from 'express';

import {
  READ_CACHE_CONTROL,
  requireSession,
  respondUnavailable,
  type SessionOptions,
} from './read-support.js';
import { fetchGoalTemplates } from '../lib/goal-templates.js';
import { GOAL_KINDS } from '../types/database.js';
import type { GoalTemplatesResponse } from '../types/api.js';

export type GoalTemplatesRouterOptions = SessionOptions;

const CONTEXT = '[api/goal-templates]';

/**
 * What a custom goal starts as.
 *
 * `medium` is public.goals' own column default, restated here so the form and the row agree about
 * what "nobody chose a size" means. All three kinds are offered: nothing about the catalogue
 * restricts which kinds an area may hold, and a UI that hardcoded that would be inventing a rule.
 */
const CUSTOM_GOAL = { kinds: [...GOAL_KINDS], defaultSize: 'medium' } as const;

/**
 * GET /api/goal-templates — the picker's contents.
 *
 * Grouped by area, every area present, plus the one statement that keeps "Something else" from
 * being a special case in the UI: a goal with nothing pre-filled is always available, in every
 * area, and may be any kind. The write path never hears about a template at all, so choosing one
 * and choosing none reach POST /api/goals by exactly the same road.
 *
 * It needs a session for the same reasons GET /api/areas does: the policy behind these rows is
 * scoped `to authenticated`, and serving reference data any other way would mean putting the
 * service-role key on a request path.
 */
export function createGoalTemplatesRouter(options: GoalTemplatesRouterOptions = {}): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const session = await requireSession(req, res, CONTEXT, options);
    if (session === undefined) return;

    try {
      const areas = await fetchGoalTemplates(session.client, options.readTimeoutMs);
      const body: GoalTemplatesResponse = {
        areas,
        custom: { kinds: [...CUSTOM_GOAL.kinds], defaultSize: CUSTOM_GOAL.defaultSize },
      };
      res.set('Cache-Control', READ_CACHE_CONTROL).json(body);
    } catch (error) {
      respondUnavailable(res, error, CONTEXT);
    }
  });

  return router;
}
