import { Router } from 'express';

import { requireSession, type SessionOptions } from './read-support.js';
import { parseOrReject, respondWritten, respondWriteFailure } from './write-support.js';
import { parseRecurrence } from '../lib/inputs.js';
import { createRecurrence, deleteRecurrence, updateRecurrence } from '../lib/recurrence-write.js';
import { pathId } from '../lib/validate.js';
import type { DeleteRecurrenceResponse, RecurrenceResponse } from '../types/api.js';

export type RecurrencesRouterOptions = SessionOptions;

const CONTEXT = '[api/goals/recurrences]';

/**
 * A goal's repeat rules: "every Tuesday and Thursday at 19:00".
 *
 * Served at /api/goals/:goalId/recurrences. Plural because the schema allows up to ten rules on
 * one goal (two sessions in a day is two rules, since a single rule has one time), even though
 * the editor will usually make one.
 *
 * Every response reports what happened to the timeline as well as the rule, because that is the
 * part a person can be surprised by: `occurrences.removed` is the future plan that was dropped
 * and regenerated, and it never includes a session that was completed, skipped or moved by hand.
 */
export function createRecurrencesRouter(options: RecurrencesRouterOptions = {}): Router {
  const router = Router();

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
