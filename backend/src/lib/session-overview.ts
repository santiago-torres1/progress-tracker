import { runQuery } from './read.js';
import { readInstant, readInteger, type UnknownRow } from './row.js';
import type { SupabaseUserClient } from './supabase.js';
import type { SessionStats } from '../types/api.js';

/*
 * Reads of public.session_overview — the account's own facts, for the profile page.
 *
 * WHY THIS IS A QUERY AND NOT A COUNT IN HERE. The numbers are over rows no route ever fetches:
 * every calendar entry and every check-in the account has recorded, which the storage caps put at
 * tens of thousands. Fetching them to call `.length` would be the same mistake as computing a
 * goal's progress in TypeScript, only more expensive — so the view counts, and this file only
 * narrows what comes back.
 *
 * WHY IT NAMES NO USER. public.users carries the users_select_self policy, so a session's SELECT
 * on this view returns exactly one row: its own. Adding `.eq('user_id', …)` would be a second copy
 * of that rule, and the copy is the one that would be wrong if it ever drifted — the same reason
 * lib/life-areas.ts has no owner filter either. `user_id` is not even selected: no response this
 * API sends carries an account id.
 */

const CONTEXT = '[api/session]';

/** Everything the profile needs from the view, and nothing that identifies the account. */
export const SESSION_OVERVIEW_COLUMNS = [
  'created_at',
  'days_since_start',
  'goals_on_board',
  'glasses_filled',
  'completions_recorded',
  'measurements_recorded',
].join(',');

/** The account's own facts, as the profile shows them. */
export interface SessionOverview {
  createdAt: string;
  stats: SessionStats;
}

export function toSessionOverview(row: UnknownRow): SessionOverview {
  return {
    createdAt: readInstant(row, 'created_at'),
    stats: {
      goalsOnBoard: readInteger(row, 'goals_on_board'),
      glassesFilled: readInteger(row, 'glasses_filled'),
      completionsRecorded: readInteger(row, 'completions_recorded'),
      measurementsRecorded: readInteger(row, 'measurements_recorded'),
      daysSinceStart: readInteger(row, 'days_since_start'),
    },
  };
}

/**
 * The caller's row of public.session_overview.
 *
 * A brand-new account is the ordinary case, not an edge one: the view is driven by public.users
 * and counts with LEFT-JOIN-shaped laterals, so a visitor with an empty board gets a row of zeros
 * rather than no row at all.
 *
 * No row at all therefore means the profile this session was resolved from has gone — the account
 * was deleted between two round trips, or a policy moved underneath us. That is a 503 like any
 * other read that cannot be served, never an empty profile the UI would render as "0 goals".
 */
export async function fetchSessionOverview(
  client: SupabaseUserClient,
  timeoutMs?: number,
): Promise<SessionOverview | undefined> {
  const rows = await runQuery(
    (signal) =>
      client.from('session_overview').select(SESSION_OVERVIEW_COLUMNS).abortSignal(signal),
    CONTEXT,
    timeoutMs,
  );

  const row = rows[0];
  return row === undefined ? undefined : toSessionOverview(row);
}
