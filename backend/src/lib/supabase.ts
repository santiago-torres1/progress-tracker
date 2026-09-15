import { createClient } from '@supabase/supabase-js';

import { readEnv } from './env.js';

/**
 * Env vars that must all be present for Supabase to count as configured. The admin client
 * below only needs the URL and service-role key, but the anon key is part of the same
 * contract (deploy sets all three), so a missing one is reported rather than ignored.
 */
export const SUPABASE_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

export type SupabaseEnvVar = (typeof SUPABASE_ENV_VARS)[number];

/** Thrown when the env vars are present but the client cannot be built from them. */
export class SupabaseConfigError extends Error {
  constructor(options?: ErrorOptions) {
    super('Supabase client could not be created from the configured environment', options);
    this.name = 'SupabaseConfigError';
  }
}

function createAdminClient(url: string, serviceRoleKey: string) {
  try {
    return createClient(url, serviceRoleKey, {
      // Stateless server usage: no session storage, no background token refresh timers.
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  } catch (error) {
    // createClient validates the URL synchronously; keep its message out of callers' responses.
    throw new SupabaseConfigError({ cause: error });
  }
}

/**
 * No generated database types yet (there is no schema). Once tables exist, generate types with
 * the Supabase CLI and pass them to createClient<Database>().
 */
export type SupabaseAdminClient = ReturnType<typeof createAdminClient>;

export type SupabaseAdmin =
  | { configured: true; client: SupabaseAdminClient }
  | { configured: false; missing: SupabaseEnvVar[] };

let cached: { url: string; serviceRoleKey: string; client: SupabaseAdminClient } | undefined;

/**
 * Returns the server-side Supabase client, authenticated with the service-role key, or the
 * list of missing env vars if Supabase is not configured.
 *
 * - Reads env vars on every call and builds the client lazily, so importing this module never
 *   throws and local dev without Supabase works.
 * - Caches the client for the life of the process (one Lambda execution environment), rebuilt
 *   only if the URL or key changes.
 * - The service-role key bypasses Row Level Security. This client must stay on the server and
 *   must never be used to serve data on behalf of an end user without explicit checks.
 */
export function getSupabaseAdmin(): SupabaseAdmin {
  const url = readEnv('SUPABASE_URL');
  const anonKey = readEnv('SUPABASE_ANON_KEY');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (url === undefined || anonKey === undefined || serviceRoleKey === undefined) {
    return {
      configured: false,
      missing: SUPABASE_ENV_VARS.filter((name) => readEnv(name) === undefined),
    };
  }

  if (cached?.url !== url || cached.serviceRoleKey !== serviceRoleKey) {
    cached = { url, serviceRoleKey, client: createAdminClient(url, serviceRoleKey) };
  }

  return { configured: true, client: cached.client };
}
