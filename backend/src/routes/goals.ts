import { Router } from 'express';

import { createCompletionsRouter } from './completions.js';
import { createMeasurementsRouter } from './measurements.js';
import { createOccurrencesRouter } from './occurrences.js';
import {
  READ_CACHE_CONTROL,
  requireSession,
  respondUnavailable,
  type SessionOptions,
} from './read-support.js';
import { createRecurrencesRouter } from './recurrences.js';
import {
  parseOrReject,
  respondDeleted,
  respondWritten,
  respondWriteFailure,
} from './write-support.js';
import { fetchActiveGoals } from '../lib/goal-dashboard.js';
import { deleteGoal, insertGoal, setGoalLayout, updateGoal } from '../lib/goal-write.js';
import { parseCreateGoal, parseLayout, parseUpdateGoal } from '../lib/inputs.js';
import { InvalidRequestError, oneOf, pathId } from '../lib/validate.js';
import { GOAL_STATUSES } from '../types/database.js';
import type { GoalResponse, GoalStatus, GoalsResponse, LayoutResponse } from '../types/api.js';

export type GoalsRouterOptions = SessionOptions;

const CONTEXT = '[api/goals]';

/**
 * Which statuses GET /api/goals returns.
 *
 * Absent means `active` — exactly what this route has always returned, so nothing that calls it
 * today sees a change. The parameter exists for "My full glasses", the shelf a finished goal moves
 * to: `?status=completed,archived`.
 */
export function parseStatusFilter(value: unknown): GoalStatus[] {
  if (value === undefined) return ['active'];
  if (typeof value !== 'string') {
    throw new InvalidRequestError('status must be a single value.', 'status');
  }

  const requested = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (requested.length === 0) {
    throw new InvalidRequestError('status must name at least one status.', 'status');
  }

  const read = oneOf(GOAL_STATUSES);
  return [...new Set(requested.map((status) => read(status, 'status')))];
}

/**
 * Goals: the dashboard, and everything that changes one.
 *
 * ROUTE ORDER MATTERS in exactly one place, and it is marked below: `/layout` has to be declared
 * before `/:goalId`, or Express matches the literal path as an id.
 *
 * Every write here passes `kind: 'write'` to requireSession, so it is charged against the write
 * quota (60/minute, 1000/hour) rather than the read one, and every write takes the owner from that
 * session. No request body on any route is allowed to name a user.
 */
export function createGoalsRouter(options: GoalsRouterOptions = {}): Router {
  const router = Router();

  /**
   * GET /api/goals — one entry per goal, in canvas order.
   *
   * Returns the caller's own goals and no one else's, and that is enforced by the goals_select
   * policy rather than by anything here: the query names no user. A new visitor's board is empty,
   * which is the milestone's intent.
   */
  router.get('/', async (req, res) => {
    const statuses = parseOrReject(res, () => parseStatusFilter(req.query.status));
    if (statuses === undefined) return;

    const session = await requireSession(req, res, CONTEXT, options);
    if (session === undefined) return;

    try {
      const goals = await fetchActiveGoals(session.client, statuses, options.readTimeoutMs);
      const body: GoalsResponse = { goals };
      res.set('Cache-Control', READ_CACHE_CONTROL).json(body);
    } catch (error) {
      respondUnavailable(res, error, CONTEXT);
    }
  });

  /**
   * POST /api/goals — a new goal.
   *
   * The body carries fields, never a template id: a template pre-fills the form in the browser and
   * is forgotten at this point, which is what keeps every suggested value editable afterwards and
   * makes "Something else" the same request with different values. 201, because this one really
   * does create a resource.
   */
  router.post('/', async (req, res) => {
    const columns = parseOrReject(res, () => parseCreateGoal(req.body));
    if (columns === undefined) return;

    const session = await requireSession(req, res, CONTEXT, { ...options, kind: 'write' });
    if (session === undefined) return;

    try {
      const goal = await insertGoal(session.client, session.userId, columns, options.readTimeoutMs);
      const body: GoalResponse = { goal };
      respondWritten(res, 201, body);
    } catch (error) {
      respondWriteFailure(res, error, CONTEXT);
    }
  });

  /**
   * PATCH /api/goals/layout — a whole drag, in one request.
   *
   * DECLARED BEFORE '/:goalId' on purpose: Express matches in order, and a parameterised route
   * would swallow this path and reject `layout` as a malformed id.
   *
   * All or nothing. If any tile in the batch is not the caller's, the database applies none of
   * them and this answers 404 — a board that is half-reordered is worse than one that did not
   * move.
   */
  router.patch('/layout', async (req, res) => {
    const tiles = parseOrReject(res, () => parseLayout(req.body));
    if (tiles === undefined) return;

    const session = await requireSession(req, res, CONTEXT, { ...options, kind: 'write' });
    if (session === undefined) return;

    try {
      const body: LayoutResponse = {
        tiles: await setGoalLayout(session.client, tiles, options.readTimeoutMs),
      };
      respondWritten(res, 200, body);
    } catch (error) {
      respondWriteFailure(res, error, CONTEXT);
    }
  });

  /**
   * PATCH /api/goals/:goalId — edit a goal, including finishing it.
   *
   * `status: 'completed'` is how a glass becomes full, and `'archived'` is how it is filed away;
   * the stamps behind both are the database's to write. `kind` is not editable — see parseUpdateGoal.
   */
  router.patch('/:goalId', async (req, res) => {
    const parsed = parseOrReject(res, () => ({
      goalId: pathId(req.params.goalId, 'goalId'),
      columns: parseUpdateGoal(req.body),
    }));
    if (parsed === undefined) return;

    const session = await requireSession(req, res, CONTEXT, { ...options, kind: 'write' });
    if (session === undefined) return;

    try {
      const goal = await updateGoal(
        session.client,
        parsed.goalId,
        parsed.columns,
        options.readTimeoutMs,
      );
      const body: GoalResponse = { goal };
      respondWritten(res, 200, body);
    } catch (error) {
      respondWriteFailure(res, error, CONTEXT);
    }
  });

  /**
   * DELETE /api/goals/:goalId — remove a goal and everything hanging off it.
   *
   * 204 on success, 404 when nothing matched — which is also the answer for another session's id,
   * because row-level security makes the two indistinguishable from here. A client retrying a
   * delete it already made should read that 404 as "already gone".
   */
  router.delete('/:goalId', async (req, res) => {
    const goalId = parseOrReject(res, () => pathId(req.params.goalId, 'goalId'));
    if (goalId === undefined) return;

    const session = await requireSession(req, res, CONTEXT, { ...options, kind: 'write' });
    if (session === undefined) return;

    try {
      await deleteGoal(session.client, goalId, options.readTimeoutMs);
      respondDeleted(res);
    } catch (error) {
      respondWriteFailure(res, error, CONTEXT);
    }
  });

  // Everything that belongs TO a goal hangs off its id, so no body can name a goal the URL does
  // not. Each sub-router spells the whole path (`/:goalId/completions`) rather than being mounted
  // under a prefix with mergeParams: that is what lets Express's own types carry `goalId` into the
  // handler, instead of a cast on something that arrived over the wire.
  router.use(createCompletionsRouter(options));
  router.use(createMeasurementsRouter(options));
  router.use(createOccurrencesRouter(options));
  router.use(createRecurrencesRouter(options));

  return router;
}
