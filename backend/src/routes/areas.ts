import { Router } from 'express';

import {
  READ_CACHE_CONTROL,
  requireSession,
  respondUnavailable,
  type SessionOptions,
} from './read-support.js';
import { fetchLifeAreas } from '../lib/life-areas.js';
import type { AreasResponse } from '../types/api.js';

export type AreasRouterOptions = SessionOptions;

const CONTEXT = '[api/areas]';

/**
 * GET /api/areas — the life areas behind the dashboard's key.
 *
 * It needs a session, even though the six built-in areas are the same for everybody today. The
 * reasons are in lib/life-areas.ts: the RLS policy that returns them is scoped `to
 * authenticated`, serving them any other way would put the service-role key on a request path,
 * and the response stops being identical for everybody the moment user-defined areas land.
 */
export function createAreasRouter(options: AreasRouterOptions = {}): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const session = await requireSession(req, res, CONTEXT, options);
    if (session === undefined) return;

    try {
      const areas = await fetchLifeAreas(session.client, options.readTimeoutMs);
      const body: AreasResponse = { areas };
      res.set('Cache-Control', READ_CACHE_CONTROL).json(body);
    } catch (error) {
      respondUnavailable(res, error, CONTEXT);
    }
  });

  return router;
}
