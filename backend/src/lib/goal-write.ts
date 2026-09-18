import { fetchGoalSummary } from './goal-dashboard.js';
import { ReadUnavailableError } from './read.js';
import { readEnum, readInteger, readString } from './row.js';
import type { SupabaseUserClient } from './supabase.js';
import type { UnknownRecord } from './validate.js';
import { requireRow, runWrite } from './write.js';
import { GOAL_SIZES } from '../types/database.js';
import type { GoalLayoutInput, GoalLayoutTile, GoalSummary } from '../types/api.js';

/*
 * Creating, changing, deleting and rearranging goals.
 *
 * WHERE OWNERSHIP COMES FROM. `user_id` is a parameter of insertGoal() and is passed the session's
 * own id by the route — it is never read from a request body, and there is no code path here that
 * could. On top of that the goals_insert policy's WITH CHECK refuses any row whose user_id is not
 * the caller's, so the value is not merely correct by convention: a bug that set it to somebody
 * else's id would be rejected by the database rather than stored.
 *
 * WHERE THE FILTERS ARE NOT. An update or a delete names the goal's id and nothing else. No
 * `.eq('user_id', …)` appears in this file, deliberately: the goals_update and goals_delete
 * policies are that filter, and a second copy would pass the isolation test whether or not the
 * policy still worked. A statement that matches nothing is a 404, which is also the right answer
 * for another session's id.
 */

const CONTEXT = '[api/goals]';

/**
 * Re-reads the tile after a write. Every write that changes a goal ends here.
 *
 * A second round trip, on purpose: the response is the dashboard's shape, and every figure in it
 * — the fraction, the period bounds, the minimum — is computed by public.goal_dashboard. Building
 * it from the row the INSERT returned would mean doing that arithmetic in TypeScript, which is
 * precisely the duplication the view exists to prevent.
 */
export async function requireSummary(
  client: SupabaseUserClient,
  goalId: string,
  timeoutMs: number | undefined,
): Promise<GoalSummary> {
  const summary = await fetchGoalSummary(client, goalId, timeoutMs);
  if (summary === undefined) {
    // The row was written and is already gone, or the view stopped matching the table. Neither is
    // the caller's doing, so it is a 503 rather than a 404.
    throw new ReadUnavailableError('upstream_error');
  }
  return summary;
}

/** Creates a goal owned by `userId` and returns the tile for it. */
export async function insertGoal(
  client: SupabaseUserClient,
  userId: string,
  columns: UnknownRecord,
  timeoutMs?: number,
): Promise<GoalSummary> {
  const rows = await runWrite(
    (signal) =>
      client
        .from('goals')
        .insert({ ...columns, user_id: userId })
        .select('id')
        .abortSignal(signal),
    CONTEXT,
    timeoutMs,
  );

  return requireSummary(client, readString(requireRow(rows, 'goal'), 'id'), timeoutMs);
}

/**
 * Changes a goal in place.
 *
 * `completed_at` and `archived_at` are not settable and are not in `columns`: the
 * goals_before_write trigger stamps them from `status`, which is what keeps "archived after being
 * completed still remembers when it was finished" true no matter which route did the archiving.
 */
export async function updateGoal(
  client: SupabaseUserClient,
  goalId: string,
  columns: UnknownRecord,
  timeoutMs?: number,
): Promise<GoalSummary> {
  const rows = await runWrite(
    (signal) =>
      client.from('goals').update(columns).eq('id', goalId).select('id').abortSignal(signal),
    CONTEXT,
    timeoutMs,
  );

  requireRow(rows, 'goal');
  return requireSummary(client, goalId, timeoutMs);
}

/**
 * Deletes a goal, and with it every rule, occurrence and check-in that hung off it (the FKs
 * cascade). Archiving is the non-destructive option and the one the UI should offer first.
 */
export async function deleteGoal(
  client: SupabaseUserClient,
  goalId: string,
  timeoutMs?: number,
): Promise<void> {
  const rows = await runWrite(
    (signal) => client.from('goals').delete().eq('id', goalId).select('id').abortSignal(signal),
    CONTEXT,
    timeoutMs,
  );

  requireRow(rows, 'goal');
}

/**
 * Applies a whole drag at once.
 *
 * One RPC rather than one request per tile: public.set_goal_layout() moves every tile in a single
 * UPDATE and refuses the batch outright unless each id matched a goal the caller owns, so a
 * dropped connection or a stale id cannot leave half a board rearranged. The failure comes back
 * as `layout_mismatch`, which lib/write.ts renders as a 404.
 */
export async function setGoalLayout(
  client: SupabaseUserClient,
  tiles: readonly GoalLayoutInput[],
  timeoutMs?: number,
): Promise<GoalLayoutTile[]> {
  const items = tiles.map((tile) => ({
    id: tile.id,
    // Absent stays absent: SQL COALESCEs it to the stored value rather than resetting it.
    ...(tile.sortOrder === undefined ? {} : { sort_order: tile.sortOrder }),
    ...(tile.size === undefined ? {} : { size: tile.size }),
  }));

  const rows = await runWrite(
    (signal) => client.rpc('set_goal_layout', { p_items: items }).abortSignal(signal),
    CONTEXT,
    timeoutMs,
  );

  return rows.map((row) => ({
    id: readString(row, 'id'),
    sortOrder: readInteger(row, 'sort_order'),
    size: readEnum(row, 'size', GOAL_SIZES),
  }));
}
