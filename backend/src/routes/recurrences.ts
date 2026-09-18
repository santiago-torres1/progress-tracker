import { Router } from 'express';

import {
  READ_CACHE_CONTROL,
  requireSession,
  respondUnavailable,
  type SessionOptions,
} from './read-support.js';
import { parseOrReject, respondWritten, respondWriteFailure } from './write-support.js';
import { parseRecurrence } from '../lib/inputs.js';
import { createRecurrence, deleteRecurrence, updateRecurrence } from '../lib/recurrence-write.js';
import { fetchRecurrences } from '../lib/recurrences.js';
import { pathId } from '../lib/validate.js';
import type {
  DeleteRecurrenceResponse,
  RecurrenceResponse,
  RecurrencesResponse,
} from '../types/api.js';

export type RecurrencesRouterOptions = SessionOptions;

const CONTEXT = '[api/goals/recurrences]';

/**
 * A goal's repeat rules: "every Tuesday and Thursday at 19:00".
 *
 * Served at /api/goals/:goalId/recurrences. Plural because the schema allows up to ten rules on
 * one goal (two sessions in a day is two rules, since a single rule has one time), even though
 * the editor will usually make one.
 *
 * Every WRITE reports what happened to the timeline as well as the rule, because that is the
 * part a person can be surprised by: `occurrences.removed` is the future plan that was dropped
 * and regenerated, and it never includes a session that was completed, skipped or moved by hand.
 * The GET reports the rules alone — nothing changed, so there is nothing to report about.
 */
export function createRecurrencesRouter(options: RecurrencesRouterOptions = {}): Router {
  const router = Router();

  /**
   * GET — the rules this goal has, paused ones included, oldest first.
   *
   * The read that makes "replace this rule" possible. Without it a client could only discover a
   * rule's id from the response to its own POST, or by spotting a materialised occurrence that
   * carried `recurrenceId` inside whatever calendar window it happened to hold — which is silence
   * rather than an answer for a rule whose occurrences all sit outside that window.
   *
   * An unknown goal id, a deleted goal and another session's goal are all `{ recurrences: [] }`,
   * the same as a goal that simply has no rules. That is not a softened 404: row-level security
   * makes those cases indistinguishable from here, and a 404 would be this route asserting that
   * an id does not exist — which is a thing it cannot know and should not say.
   */
  router.get('/:goalId/recurrences', async (req, res) => {
    const goalId = parseOrReject(res, () => pathId(req.params.goalId, 'goalId'));
    if (goalId === undefined) return;

    // Spelled out rather than left to default, because every other call in this file says
    // 'write': a read charged against the write quota would be a quiet bug.
    const session = await requireSession(req, res, CONTEXT, { ...options, kind: 'read' });
    if (session === undefined) return;

    try {
      const recurrences = await fetchRecurrences(session.client, goalId, options.readTimeoutMs);
      const body: RecurrencesResponse = { recurrences };
      res.set('Cache-Control', READ_CACHE_CONTROL).json(body);
    } catch (error) {
      respondUnavailable(res, error, CONTEXT);
    }
  });

  /** POST — add a rule and materialise it to the horizon, in one transaction. */
  router.post('/:goalId/recurrences', async (req, res) => {
    const parsed = parseOrReject(res, () => ({
      goalId: pathId(req.params.goalId, 'goalId'),
      rule: parseRecurrence(req.body),
    }));
    if (parsed === undefined) return;

    const session = await requireSession(req, res, CONTEXT, { ...options, kind: 'write' });
    if (session === undefined) return;

    try {
      const result = await createRecurrence(
        session.client,
        parsed.goalId,
        parsed.rule,
        options.readTimeoutMs,
      );
      const body: RecurrenceResponse = result;
      respondWritten(res, 201, body);
    } catch (error) {
      respondWriteFailure(res, error, CONTEXT);
    }
  });

  /**
   * PUT — replace the rule.
   *
   * PUT rather than PATCH because a rule is replaced whole. The editor holds all of it anyway, and
   * a partial update would make an absent `untilDate` ambiguous between "leave the end date" and
   * "remove it" — for a field where both readings are plausible and only one is right.
   */
  router.put('/:goalId/recurrences/:recurrenceId', async (req, res) => {
    const parsed = parseOrReject(res, () => ({
      goalId: pathId(req.params.goalId, 'goalId'),
      recurrenceId: pathId(req.params.recurrenceId, 'recurrenceId'),
      rule: parseRecurrence(req.body),
    }));
    if (parsed === undefined) return;

    const session = await requireSession(req, res, CONTEXT, { ...options, kind: 'write' });
    if (session === undefined) return;

    try {
      const result = await updateRecurrence(
        session.client,
        parsed.goalId,
        parsed.recurrenceId,
        parsed.rule,
        options.readTimeoutMs,
      );
      const body: RecurrenceResponse = result;
      respondWritten(res, 200, body);
    } catch (error) {
      respondWriteFailure(res, error, CONTEXT);
    }
  });

  /**
   * DELETE — drop the rule and its future plan.
   *
   * 200 with a body, not 204: the interesting part is what was kept. Occurrences that already
   * happened survive, detached from the rule, because the progress they record is a fact and
   * deleting the plan does not unmake it.
   */
  router.delete('/:goalId/recurrences/:recurrenceId', async (req, res) => {
    const parsed = parseOrReject(res, () => ({
      goalId: pathId(req.params.goalId, 'goalId'),
      recurrenceId: pathId(req.params.recurrenceId, 'recurrenceId'),
    }));
    if (parsed === undefined) return;

    const session = await requireSession(req, res, CONTEXT, { ...options, kind: 'write' });
    if (session === undefined) return;

    try {
      const { id, removed, kept } = await deleteRecurrence(
        session.client,
        parsed.goalId,
        parsed.recurrenceId,
        options.readTimeoutMs,
      );
      const body: DeleteRecurrenceResponse = { id, occurrences: { removed, kept } };
      respondWritten(res, 200, body);
    } catch (error) {
      respondWriteFailure(res, error, CONTEXT);
    }
  });

  return router;
}
