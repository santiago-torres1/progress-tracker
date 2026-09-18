import { ReadUnavailableError } from './read.js';
import { readInteger, readString, type UnknownRow } from './row.js';
import type { SupabaseUserClient } from './supabase.js';
import type { UnknownRecord } from './validate.js';
import { runWrite } from './write.js';

/*
 * The three preferences a session may change about itself.
 *
 * WHAT MAKES THIS SAFE IS A GRANT, NOT A ROUTE. 20260917100000 revoked the blanket UPDATE on
 * public.users and granted it column by column:
 *
 *   grant update (display_name, time_zone, week_starts_on) on table public.users to authenticated;
 *
 * so `is_anonymous` (opting out of expiry), `last_seen_at` (living forever) and `auth_user_id`
 * (becoming somebody else) are not writable by a session at all — not by this module, not by a
 * bug in it, and not by a browser talking to PostgREST directly with the same token. The parser
 * below builds the column payload itself and ignores unknown keys, which is the second layer; the
 * grant is the one that would still hold if this file were wrong.
 *
 * WHICH ROW. `id` comes from the Session, i.e. from public.begin_request(), i.e. from the verified
 * JWT — never from the body, which has no field for it. It is here to name one row rather than to
 * stand in for the policy: users_update_self (USING and WITH CHECK on auth_user_id = auth.uid())
 * is still what decides the write is allowed, and it would refuse this statement if the id were
 * ever anything else.
 */

const CONTEXT = '[api/session]';

/** The columns a session owns, as they come back after a write. */
export interface ProfileColumns {
  displayName: string;
  timeZone: string;
  weekStartsOn: number;
}

export function toProfileColumns(row: UnknownRow): ProfileColumns {
  return {
    displayName: readString(row, 'display_name'),
    timeZone: readString(row, 'time_zone'),
    weekStartsOn: readInteger(row, 'week_starts_on'),
  };
}

/**
 * Applies the change and returns the profile as it now stands.
 *
 * An empty result means the row the session was resolved from is no longer there — the account was
 * deleted between two round trips, or a policy changed underneath us. Neither is the caller's
 * doing and neither is worth a retry loop, so it is a 503 rather than a 404.
 */
export async function updateProfile(
  client: SupabaseUserClient,
  userId: string,
  columns: UnknownRecord,
  timeoutMs?: number,
): Promise<ProfileColumns> {
  const rows = await runWrite(
    (signal) =>
      client
        .from('users')
        .update(columns)
        .eq('id', userId)
        .select('display_name,time_zone,week_starts_on')
        .abortSignal(signal),
    CONTEXT,
    timeoutMs,
  );

  const row = rows[0];
  if (row === undefined) throw new ReadUnavailableError('upstream_error');
  return toProfileColumns(row);
}
