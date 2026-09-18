import { Router } from 'express';

import { READ_CACHE_CONTROL, requireSession, type SessionOptions } from './read-support.js';
import { parseOrReject, respondWritten, respondWriteFailure } from './write-support.js';
import { parseUpdateSession } from '../lib/inputs.js';
import { updateProfile } from '../lib/session-write.js';
import type { Session } from '../lib/session.js';
import type { SessionProfile, SessionResponse } from '../types/api.js';

export type SessionRouterOptions = SessionOptions;

const CONTEXT = '[api/session]';

/**
 * The profile, as the client sees it.
 *
 * No id. Every route is already scoped by the token, so the client has no use for one, and the
 * rule that no response carries an account id is worth more than the convenience — it is what
 * makes "this body contains no identifier" a thing the tests can assert outright.
 */
function toProfile(session: Session, overrides: Partial<SessionProfile> = {}): SessionProfile {
  return {
    timeZone: session.timeZone,
    weekStartsOn: session.weekStartsOn,
    isAnonymous: session.isAnonymous,
    expiresAt: session.expiresAt,
    ...overrides,
  };
}

/**
 * The caller's own preferences: which zone their day is measured in, and where their week starts.
 *
 * WHY THIS ROUTE EXISTS AT ALL. "Complete today" and "log today's number" resolve the day from
 * public.users.time_zone, and so do habit period boundaries. That column defaults to 'UTC', so
 * without a way to set it somebody in New York tapping a tile at eight in the evening records it
 * against tomorrow — the most visible bug this app could ship. The column, its validation and the
 * grant that makes it writable have all been in place since Phase 1; only the endpoint was
 * missing.
 *
 * GET COSTS NOTHING EXTRA. public.begin_request() already returns the whole profile, because it
 * has to resolve it anyway to charge the request, so the read is served from the session that
 * every /api route resolves regardless — no second round trip, and no second copy of these values
 * anywhere in the backend.
 */
export function createSessionRouter(options: SessionRouterOptions = {}): Router {
  const router = Router();

  /**
   * GET /api/session — who the caller is to this app.
   *
   * Charged against the READ quota: it writes nothing, and the client will call it on every cold
   * start to learn the zone and week start it should render with.
   *
   * `expiresAt` is here deliberately. An anonymous account is deleted 90 days after its last
   * visit, and until now nothing in the product could tell anyone that. It is null once an
   * account is permanent, because then it would be a lie.
   */
  router.get('/', async (req, res) => {
    const session = await requireSession(req, res, CONTEXT, options);
    if (session === undefined) return;

    const body: SessionResponse = { session: toProfile(session) };
    res.set('Cache-Control', READ_CACHE_CONTROL).json(body);
  });

  /**
   * PATCH /api/session — set the zone, the week start, or both.
   *
   * A write, so it is charged against the write quota. The profile it changes is the caller's,
   * taken from the session; there is no field in the request that names an account, and the
   * column-level grant means the two columns below are the only ones a session can move.
   */
  router.patch('/', async (req, res) => {
    const columns = parseOrReject(res, () => parseUpdateSession(req.body));
    if (columns === undefined) return;

    const session = await requireSession(req, res, CONTEXT, { ...options, kind: 'write' });
    if (session === undefined) return;

    try {
      const updated = await updateProfile(
        session.client,
        session.userId,
        columns,
        options.readTimeoutMs,
      );
      // Read back what the database stored, not what was asked for: it is the same value today,
      // and a normalising trigger tomorrow would make it not be.
      const body: SessionResponse = {
        session: toProfile(session, {
          timeZone: updated.timeZone,
          weekStartsOn: updated.weekStartsOn,
        }),
      };
      respondWritten(res, 200, body);
    } catch (error) {
      respondWriteFailure(res, error, CONTEXT);
    }
  });

  return router;
}
