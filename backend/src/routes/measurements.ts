import { Router } from 'express';

import { requireSession, type SessionOptions } from './read-support.js';
import { parseOrReject, respondWritten, respondWriteFailure } from './write-support.js';
import { requireSummary } from '../lib/goal-write.js';
import { parseLogMeasurement, parseUpdateMeasurement } from '../lib/inputs.js';
import { deleteMeasurement, logMeasurement, updateMeasurement } from '../lib/measurement-write.js';
import { pathId } from '../lib/validate.js';
import type { DeleteMeasurementResponse, MeasurementResponse } from '../types/api.js';

export type MeasurementsRouterOptions = SessionOptions;

const CONTEXT = '[api/goals/measurements]';

/**
 * Check-ins against a measured goal: "81.6 kg today".
 *
 * Served at /api/goals/:goalId/measurements. Every response carries the recomputed tile, because
 * a check-in's whole purpose is to move the glass — and where it moves to is
 * (latest - start) / (target - start), computed by the view rather than by anyone here.
 */
export function createMeasurementsRouter(options: MeasurementsRouterOptions = {}): Router {
  const router = Router();

  /**
   * POST — record the value on a day.
   *
   * 200 rather than 201, and deliberately so: a day holds at most one check-in, so this is an
   * upsert. Sending it twice for the same day is a correction, and a retried request after a lost
   * response leaves exactly one row. Answering 201 would claim a new resource for a write that
   * often creates nothing.
   */
  router.post('/:goalId/measurements', async (req, res) => {
    const parsed = parseOrReject(res, () => ({
      goalId: pathId(req.params.goalId, 'goalId'),
      body: parseLogMeasurement(req.body),
    }));
    if (parsed === undefined) return;

    const session = await requireSession(req, res, CONTEXT, { ...options, kind: 'write' });
    if (session === undefined) return;

    try {
      const measurement = await logMeasurement(
        session.client,
        parsed.goalId,
        parsed.body,
        options.readTimeoutMs,
      );
      const goal = await requireSummary(session.client, parsed.goalId, options.readTimeoutMs);
      const body: MeasurementResponse = { measurement, goal };
      respondWritten(res, 200, body);
    } catch (error) {
      respondWriteFailure(res, error, CONTEXT);
    }
  });

  /** PATCH — correct one that is already logged: a different number, note, or day. */
  router.patch('/:goalId/measurements/:measurementId', async (req, res) => {
    const parsed = parseOrReject(res, () => ({
      goalId: pathId(req.params.goalId, 'goalId'),
      measurementId: pathId(req.params.measurementId, 'measurementId'),
      columns: parseUpdateMeasurement(req.body),
    }));
    if (parsed === undefined) return;

    const session = await requireSession(req, res, CONTEXT, { ...options, kind: 'write' });
    if (session === undefined) return;

    try {
      const measurement = await updateMeasurement(
        session.client,
        parsed.goalId,
        parsed.measurementId,
        parsed.columns,
        options.readTimeoutMs,
      );
      const goal = await requireSummary(session.client, parsed.goalId, options.readTimeoutMs);
      const body: MeasurementResponse = { measurement, goal };
      respondWritten(res, 200, body);
    } catch (error) {
      respondWriteFailure(res, error, CONTEXT);
    }
  });

  /**
   * DELETE — undo a check-in.
   *
   * Answers 200 with the tile rather than 204: deleting a check-in changes what the goal reads,
   * and the previous value comes back on its own because progress is computed from the rows that
   * remain. There is no stored number to restore and nothing for the client to guess.
   */
  router.delete('/:goalId/measurements/:measurementId', async (req, res) => {
    const parsed = parseOrReject(res, () => ({
      goalId: pathId(req.params.goalId, 'goalId'),
      measurementId: pathId(req.params.measurementId, 'measurementId'),
    }));
    if (parsed === undefined) return;

    const session = await requireSession(req, res, CONTEXT, { ...options, kind: 'write' });
    if (session === undefined) return;

    try {
      await deleteMeasurement(
        session.client,
        parsed.goalId,
        parsed.measurementId,
        options.readTimeoutMs,
      );
      const goal = await requireSummary(session.client, parsed.goalId, options.readTimeoutMs);
      const body: DeleteMeasurementResponse = { goal };
      respondWritten(res, 200, body);
    } catch (error) {
      respondWriteFailure(res, error, CONTEXT);
    }
  });

  return router;
}
