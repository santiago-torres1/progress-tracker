import { createClient } from '@supabase/supabase-js';

import { readEnv } from './env.js';

/**
 * Env vars that must all be present for Supabase to count as configured.
 *
 * All three are genuinely used now: the anon key builds the per-request client that carries the
 * caller's access token, and the service-role key is kept for maintenance only.
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

interface SupabaseCredentials {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

export type SupabaseConfig =
  | { configured: true; credentials: SupabaseCredentials }
  | { configured: false; missing: SupabaseEnvVar[] };

/** The three variables, or the names of the ones that are unset. Never their values. */
export function readSupabaseConfig(): SupabaseConfig {
  const url = readEnv('SUPABASE_URL');
  const anonKey = readEnv('SUPABASE_ANON_KEY');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (url === undefined || anonKey === undefined || serviceRoleKey === undefined) {
    return {
      configured: false,
      missing: SUPABASE_ENV_VARS.filter((name) => readEnv(name) === undefined),
    };
  }

  return { configured: true, credentials: { url, anonKey, serviceRoleKey } };
}

/** Stateless server usage: no session storage, no background token refresh timers. */
const STATELESS_AUTH = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

function createConfiguredClient(url: string, key: string, accessToken?: string) {
  try {
    return createClient(url, key, {
      auth: STATELESS_AUTH,
      ...(accessToken === undefined
        ? {}
        : { global: { headers: { Authorization: `Bearer ${accessToken}` } } }),
    });
  } catch (error) {
    // createClient validates the URL synchronously; keep its message out of callers' responses.
    throw new SupabaseConfigError({ cause: error });
  }
}

/**
 * No generated database types yet. Once the project is linked, generate them with the Supabase
 * CLI and pass them to createClient<Database>().
 */
export type SupabaseAdminClient = ReturnType<typeof createConfiguredClient>;

/** Structurally identical to the admin client; the alias records which key is behind it. */
export type SupabaseUserClient = SupabaseAdminClient;

/**
 * A client that acts AS THE CALLER: the anon key plus their access token, so PostgREST resolves
 * auth.uid() from that token and applies row-level security as that user.
 *
 * Built fresh for every request and thrown away with it. Nothing user-specific is cached across
 * requests — a Lambda execution environment is reused by unrelated callers, and a client holding
 * one visitor's token is exactly the kind of state that ends up serving it to the next one.
 * Construction is object allocation only; no connection is opened until a query runs.
 */
export function createUserClient(credentials: SupabaseCredentials, accessToken: string) {
  return createConfiguredClient(credentials.url, credentials.anonKey, accessToken);
}

export type SupabaseAdmin =
  | { configured: true; client: SupabaseAdminClient }
  | { configured: false; missing: SupabaseEnvVar[] };

let cached: { url: string; serviceRoleKey: string; client: SupabaseAdminClient } | undefined;

/**
 * THE MAINTENANCE CLIENT. It must never serve a request.
 *
 * The service-role key has BYPASSRLS: it sees and writes every account's rows, so a route that
 * used it would silently defeat every policy in supabase/migrations. Row-level security is the
 * thing that isolates one anonymous session from another, and it only works if the request path
 * uses the caller's token — see createUserClient() above, which is what /api/* uses.
 *
 * The legitimate users of this client are jobs that act on nobody's behalf:
 *   * GET /health/db, which probes the GoTrue admin API to prove the key and URL work;
 *   * scheduled maintenance (public.delete_expired_anonymous_users(), the recurrence horizon).
 *
 * Cached for the life of the process because it is not user-specific — that is precisely the
 * difference between it and the per-request client, and the reason the two are separate
 * functions rather than one function with a flag.
 */
export function getSupabaseAdmin(): SupabaseAdmin {
  const config = readSupabaseConfig();
  if (!config.configured) return config;

  const { url, serviceRoleKey } = config.credentials;
  if (cached?.url !== url || cached.serviceRoleKey !== serviceRoleKey) {
    cached = { url, serviceRoleKey, client: createConfiguredClient(url, serviceRoleKey) };
  }

  return { configured: true, client: cached.client };
}
