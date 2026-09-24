import { Router } from 'express';

import {
  READ_CACHE_CONTROL,
  requireSession,
  respondUnavailable,
  type SessionOptions,
} from './read-support.js';
import { parseOrReject, respondWritten, respondWriteFailure } from './write-support.js';
import { parseUpdateSession } from '../lib/inputs.js';
import { ReadUnavailableError } from '../lib/read.js';
import { fetchSessionOverview, type SessionOverview } from '../lib/session-overview.js';
import { updateProfile } from '../lib/session-write.js';
import type { Session } from '../lib/session.js';
import type { SessionProfile, SessionResponse } from '../types/api.js';

export type SessionRouterOptions = SessionOptions;

const CONTEXT = '[api/session]';

/** The two columns a session may change about itself, from wherever they were last read. */
interface Preferences {
  timeZone: string;
  weekStartsOn: number;
}

/**
 * The profile, as the client sees it.
 *
 * No id. Every route is already scoped by the token, so the client has no use for one, and the
 * rule that no response carries an account id is worth more than the convenience — it is what
 * makes "this body contains no identifier" a thing the tests can assert outright.
 *
 * The three sources are deliberately distinct: the session carries what public.begin_request()
 * resolved to charge the request, `facts` carries what public.session_overview counted, and
 * `preferences` is whichever of the two is newer — the session's on a read, the row the database
 * stored on a write.
 */
function toProfile(
  session: Session,
  facts: SessionOverview,
  preferences: Preferences,
): SessionProfile {
  return {
    timeZone: preferences.timeZone,
    weekStartsOn: preferences.weekStartsOn,
    isAnonymous: session.isAnonymous,
    expiresAt: session.expiresAt,
    createdAt: facts.createdAt,
    stats: facts.stats,
  };
}

/**
 * The account's own facts, or a failure.
 *
 * An empty result is not "a new account with nothing on its board" — that case is a row of zeros,
 * because the view is driven by public.users. It means the profile this request was resolved from
 * is gone, which is the same 503 lib/session-write.ts answers with for the same reason.
 */
async function requireAccountFacts(session: Session, timeoutMs?: number): Promise<SessionOverview> {
  const facts = await fetchSessionOverview(session.client, timeoutMs);
  if (facts === undefined) throw new ReadUnavailableError('upstream_error');
  return facts;
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
 * THE PREFERENCES COST NOTHING EXTRA. public.begin_request() already returns them, because it has
 * to resolve the profile anyway to charge the request, so they are served from the session every
 * /api route resolves regardless — no second copy of these values anywhere in the backend.
 *
 * THE PROFILE PAGE'S FACTS COST ONE QUERY, AND ONLY HERE. `createdAt` and `stats` come from
 * public.session_overview (20260923100000). Putting them in begin_request() would have made them
 * free on this route and charged for on every other one — the dashboard, the calendar and every
 * write would all count goals and check-ins nobody asked them to count. One extra round trip on
 * the one route that reads them is the cheaper half of that trade by a wide margin.
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
   *
   * `stats` is a row of zeros for a visitor who has not made a goal yet, and that is the correct
   * answer rather than an absent one — "nothing here yet" is a state this product is comfortable
   * with, and the profile page can say so without the client guessing.
   */
  router.get('/', async (req, res) => {
    const session = await requireSession(req, res, CONTEXT, options);
    if (session === undefined) return;

    try {
      const facts = await requireAccountFacts(session, options.readTimeoutMs);
      const body: SessionResponse = { session: toProfile(session, facts, session) };
      res.set('Cache-Control', READ_CACHE_CONTROL).json(body);
    } catch (error) {
      respondUnavailable(res, error, CONTEXT);
    }
  });

  /**
   * PATCH /api/session — set the zone, the week start, or both.
   *
   * A write, so it is charged against the write quota. The profile it changes is the caller's,
   * taken from the session; there is no field in the request that names an account, and the
   * column-level grant means the two columns below are the only ones a session can move.
   *
   * It answers with the WHOLE profile, facts included, for the reason every write in this API
   * returns the recomputed goal: the client replaces what it holds from the response instead of
   * refetching. Reading the facts after the update rather than before is deliberate — `timeZone`
   * is what `daysSinceStart` is counted in, so the zone the caller just set is the one the number
   * comes back in.
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
      const facts = await requireAccountFacts(session, options.readTimeoutMs);
      const body: SessionResponse = { session: toProfile(session, facts, updated) };
      respondWritten(res, 200, body);
    } catch (error) {
      respondWriteFailure(res, error, CONTEXT);
    }
  });

  return router;
}
