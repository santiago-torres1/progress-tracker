import { readDate, readNumeric, readOptionalString, readString, type UnknownRow } from './row.js';
import type { SupabaseUserClient } from './supabase.js';
import type { UnknownRecord } from './validate.js';
import { requireRow, runWrite } from './write.js';
import { readInstant, readOptionalString as readOptionalId } from './row.js';
import type { Measurement } from '../types/api.js';

/*
 * Check-ins against a measured goal: "81.6 kg today".
 *
 * THE FACT BEING STORED is where the number IS on a day, not that a reading happened — a measured
 * goal's progress is (latest - start) / (target - start), and only the latest one is ever read. So
 * a day holds at most one check-in (progress_entries_goal_day_uidx), logging is an UPSERT, and
 * logging the same day twice is a correction rather than a second row.
 *
 * That is also what makes the write idempotent. A retried POST — the response was lost, the user
 * tapped save twice — writes the same row twice and leaves one. Nothing accumulates, and nothing
 * silently counts against the 750-per-goal cap for a value nobody will ever read.
 *
 * UNDOING a check-in is deleting it, and that restores the previous value exactly with nothing
 * remembered anywhere: the view simply reads the next-latest row again, or start_value when there
 * is none. Progress is computed, so there is no stored number to put back.
 */

const CONTEXT = '[api/goals/measurements]';

export function toMeasurement(row: UnknownRow): Measurement {
  return {
    id: readString(row, 'id'),
    goalId: readString(row, 'goal_id'),
    occurredOn: readDate(row, 'occurred_on'),
    value: readNumeric(row, 'value'),
    note: readOptionalString(row, 'note'),
    calendarEntryId: readOptionalId(row, 'calendar_entry_id'),
    createdAt: readInstant(row, 'created_at'),
    updatedAt: readInstant(row, 'updated_at'),
  };
}

/**
 * Logs (or re-logs) the value on a day.
 *
 * An RPC rather than an upsert from here, for one reason that is not convenience: the goal has to
 * be a measured one, and that check belongs next to the write, in the same transaction, under the
 * same policies. A check-in against a habit would be a row public.goal_progress never reads,
 * sitting against that goal's cap — so it is refused as `wrong_goal_kind`, which becomes a 409.
 */
export async function logMeasurement(
  client: SupabaseUserClient,
  goalId: string,
  input: { value: number; occurredOn?: string; note?: string | null },
  timeoutMs?: number,
): Promise<Measurement> {
  const rows = await runWrite(
    (signal) =>
      client
        .rpc('log_measurement', {
          p_goal_id: goalId,
          p_value: input.value,
          p_occurred_on: input.occurredOn ?? null,
          p_note: input.note ?? null,
        })
        .abortSignal(signal),
    CONTEXT,
    timeoutMs,
  );

  return toMeasurement(requireRow(rows, 'goal'));
}

/**
 * Corrects a check-in that is already logged.
 *
 * Both ids are named: the measurement's, and the goal's from the path. The second is not an
 * ownership check — row-level security is that — but a relationship one, so a correction sent to
 * the wrong goal's URL is a 404 rather than a silent edit of a row under a different tile.
 */
export async function updateMeasurement(
  client: SupabaseUserClient,
  goalId: string,
  measurementId: string,
  columns: UnknownRecord,
  timeoutMs?: number,
): Promise<Measurement> {
  const rows = await runWrite(
    (signal) =>
      client
        .from('progress_entries')
        .update(columns)
        .eq('id', measurementId)
        .eq('goal_id', goalId)
        .select('id,goal_id,calendar_entry_id,occurred_on,value,note,created_at,updated_at')
        .abortSignal(signal),
    CONTEXT,
    timeoutMs,
  );

  return toMeasurement(requireRow(rows, 'measurement'));
}

/** Deletes a check-in. The goal's current value falls back to the one before it, in SQL. */
export async function deleteMeasurement(
  client: SupabaseUserClient,
  goalId: string,
  measurementId: string,
  timeoutMs?: number,
): Promise<void> {
  const rows = await runWrite(
    (signal) =>
      client
        .from('progress_entries')
        .delete()
        .eq('id', measurementId)
        .eq('goal_id', goalId)
        .select('id')
        .abortSignal(signal),
    CONTEXT,
    timeoutMs,
  );

  requireRow(rows, 'measurement');
}
