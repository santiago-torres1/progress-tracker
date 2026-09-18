import { Router } from 'express';

import { requireSession, type SessionOptions } from './read-support.js';
import { parseOrReject, respondWritten, respondWriteFailure } from './write-support.js';
import { requireSummary } from '../lib/goal-write.js';
import { parseCompleteOccurrence } from '../lib/inputs.js';
import {
  completeOccurrence,
  toEntry,
  toEntryGoal,
  undoOccurrence,
} from '../lib/occurrence-write.js';
import { pathId } from '../lib/validate.js';
import type { CompletionResponse, UndoCompletionResponse } from '../types/api.js';

export type CompletionsRouterOptions = SessionOptions;

const CONTEXT = '[api/goals/completions]';

/**
 * The tap on a tile, and the tap that takes it back.
 *
 * Served at /api/goals/:goalId/completions, so the goal is in the path and never in the body —
 * there is no request shape here that could name a goal the URL does not.
 *
 * Both routes answer with the recomputed tile as well as the occurrence. That is one extra read
 * per tap, and it buys the thing this release is about: the glass fills (or empties) from the
 * response, with no second request and no client-side arithmetic that could disagree with the
 * view's.
 */
export function createCompletionsRouter(options: CompletionsRouterOptions = {}): Router {
  const router = Router();

  /**
   * POST — "I did it."
   *
   * 200, not 201, even when a row is created: the caller is recording that something happened,
   * not creating a resource at a URL they will fetch, and the operation is idempotent — two taps
   * on the same day are one completion. `created` in the body says whether a row appeared, which
   * is what a calendar needs in order to insert rather than update.
   */
  router.post('/:goalId/completions', async (req, res) => {
    const parsed = parseOrReject(res, () => ({
      goalId: pathId(req.params.goalId, 'goalId'),
      body: parseCompleteOccurrence(req.body),
    }));
    if (parsed === undefined) return;

    const session = await requireSession(req, res, CONTEXT, { ...options, kind: 'write' });
    if (session === undefined) return;

    try {
      const { created, row } = await completeOccurrence(
        session.client,
        parsed.goalId,
        parsed.body,
        options.readTimeoutMs,
      );
      const goal = await requireSummary(session.client, parsed.goalId, options.readTimeoutMs);
      const body: CompletionResponse = {
        created,
        entry: toEntry(row, toEntryGoal(goal)),
        goal,
      };
      respondWritten(res, 200, body);
    } catch (error) {
      respondWriteFailure(res, error, CONTEXT);
    }
  });

  /**
   * DELETE — "no, take that back."
   *
   * Answers with a body rather than 204 because undo is not a simple removal: `action` says
   * whether the occurrence was restored to its previous status or deleted outright, and the tile
   * comes back with it. A retried undo lands on `noop`; a retry after a delete gets 404, which a
   * client should read as "already taken back".
   */
  router.delete('/:goalId/completions/:entryId', async (req, res) => {
    const parsed = parseOrReject(res, () => ({
      goalId: pathId(req.params.goalId, 'goalId'),
      entryId: pathId(req.params.entryId, 'entryId'),
    }));
    if (parsed === undefined) return;

    const session = await requireSession(req, res, CONTEXT, { ...options, kind: 'write' });
    if (session === undefined) return;

    try {
      const { action, row } = await undoOccurrence(
        session.client,
        parsed.goalId,
        parsed.entryId,
        options.readTimeoutMs,
      );
      const goal = await requireSummary(session.client, parsed.goalId, options.readTimeoutMs);
      const body: UndoCompletionResponse = { action, entry: toEntry(row, toEntryGoal(goal)), goal };
      respondWritten(res, 200, body);
    } catch (error) {
      respondWriteFailure(res, error, CONTEXT);
    }
  });

  return router;
}
