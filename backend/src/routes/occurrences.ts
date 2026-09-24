import { Router } from 'express';

import { requireSession, type SessionOptions } from './read-support.js';
import { parseOrReject, respondWritten, respondWriteFailure } from './write-support.js';
import { requireSummary } from '../lib/goal-write.js';
import { deleteOccurrence } from '../lib/occurrence-write.js';
import { pathId } from '../lib/validate.js';
import type { DeleteOccurrenceResponse } from '../types/api.js';

export type OccurrencesRouterOptions = SessionOptions;

const CONTEXT = '[api/goals/occurrences]';

/**
 * One day, removed from the calendar: "I am not running this Thursday."
 *
 * Served at /api/goals/:goalId/occurrences/:entryId, so both halves of the key are in the path
 * and no body can name a goal the URL does not. The same route serves the tile and the calendar —
 * every entry a calendar renders already carries its goal, so there is no second endpoint for
 * "delete it from over here".
 *
 * WHAT THIS IS NOT. It is not undo, and it is not a way to delete a repeat rule. Undo
 * (DELETE …/completions/:entryId) takes back something that was done and restores the exact state
 * the day held before; deleting the rule (DELETE …/recurrences/:recurrenceId) removes the whole
 * plan. This removes ONE planned day and leaves the rule making all the others.
 */
export function createOccurrencesRouter(options: OccurrencesRouterOptions = {}): Router {
  const router = Router();

  /**
   * DELETE — take this one day off the calendar.
   *
   * 200 with a body rather than 204, for the same reason every other write here answers with one:
   * the tile has changed. A scheduled goal that was due on that day is due on one fewer, so its
   * adherence has moved, and the response is what refills the glass without a second request.
   *
   * THE PAST IS DELETABLE, deliberately. Editing a repeat rule is frozen at the caller's today
   * because re-expanding would ADD days to the past and drop adherence for doing nothing.
   * Removing a single occurrence can only ever take a day OUT of that denominator, so it cannot
   * lower any goal's progress — there is nothing for a freeze to protect, and a person correcting
   * last Thursday is fixing a plan rather than rewriting history.
   *
   * A COMPLETED DAY IS REFUSED, with 409 `entry_completed`. That day is the record of something
   * they did, and it must not disappear through a route called "delete"; undo is the way back,
   * and after it the day deletes like any other. 404 means the occurrence is already gone — or
   * was never the caller's, which row-level security makes the same fact — and a client should
   * read it as success.
   */
  router.delete('/:goalId/occurrences/:entryId', async (req, res) => {
    const parsed = parseOrReject(res, () => ({
      goalId: pathId(req.params.goalId, 'goalId'),
      entryId: pathId(req.params.entryId, 'entryId'),
    }));
    if (parsed === undefined) return;

    const session = await requireSession(req, res, CONTEXT, { ...options, kind: 'write' });
    if (session === undefined) return;

    try {
      const { action, id } = await deleteOccurrence(
        session.client,
        parsed.goalId,
        parsed.entryId,
        options.readTimeoutMs,
      );
      const goal = await requireSummary(session.client, parsed.goalId, options.readTimeoutMs);
      const body: DeleteOccurrenceResponse = { id, action, goal };
      respondWritten(res, 200, body);
    } catch (error) {
      respondWriteFailure(res, error, CONTEXT);
    }
  });

  return router;
}
