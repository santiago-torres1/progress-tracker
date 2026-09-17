import { Router } from 'express';

import { READ_CACHE_CONTROL, respondUnavailable } from './read-support.js';
import { fetchLifeAreas } from '../lib/life-areas.js';
import type { AreasResponse } from '../types/api.js';

export interface AreasRouterOptions {
  /** Upper bound on the Supabase round-trip. Overridable for tests. */
  readTimeoutMs?: number;
}

/** GET /api/areas — the life areas behind the dashboard's key. */
export function createAreasRouter(options: AreasRouterOptions = {}): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const areas = await fetchLifeAreas(options.readTimeoutMs);
      const body: AreasResponse = { areas };
      res.set('Cache-Control', READ_CACHE_CONTROL).json(body);
    } catch (error) {
      respondUnavailable(res, error, '[api/areas]');
    }
  });

  return router;
}
