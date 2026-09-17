import { readEnv } from './env.js';

/**
 * The single login-less user.
 *
 * `supabase/migrations/20260916090500_reference_data.sql` inserts exactly one `public.users`
 * row with this fixed id, and a partial unique index (`users_single_default_uidx`) stops there
 * ever being two. Resolving it from a constant rather than querying `public.default_user_id()`
 * saves a round-trip on every request, which matters when each one is a cold-ish Lambda.
 *
 * When Supabase Auth arrives (v0.1.2) this disappears: reads move onto the caller's access
 * token and RLS resolves identity instead.
 */
export const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown when an environment variable is present but unusable. */
export class InvalidUserConfigError extends Error {
  constructor(name: string) {
    super(`${name} is not a valid UUID`);
    this.name = 'InvalidUserConfigError';
  }
}

/**
 * The user id every read is scoped to: `DEFAULT_USER_ID` env var, else the documented constant.
 *
 * A malformed override throws rather than falling back. Silently ignoring it would serve the
 * wrong person's data, which is worse than a clear 503 — and the message names only the
 * variable, never its value.
 */
export function getDefaultUserId(): string {
  const configured = readEnv('DEFAULT_USER_ID');
  if (configured === undefined) return DEFAULT_USER_ID;
  if (!UUID_PATTERN.test(configured)) throw new InvalidUserConfigError('DEFAULT_USER_ID');
  return configured;
}
