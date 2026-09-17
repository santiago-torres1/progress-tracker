import { asRows, RowShapeError, type UnknownRow } from './row.js';
import { getSupabaseAdmin, SupabaseConfigError, type SupabaseAdminClient } from './supabase.js';
import { TimeoutError, withTimeout } from './timeout.js';
import { InvalidUserConfigError } from './user.js';
import type { UnavailableReason } from '../types/api.js';

/**
 * Shared plumbing for the read-only API: get a client, run one query under a deadline, and turn
 * anything that goes wrong into a single opaque failure the routes can render as a 503.
 *
 * The discipline is the one GET /health/db already follows: a short reason code, never an
 * upstream message, never a secret. Detail goes to the server log (CloudWatch on Lambda).
 */

/** Upper bound on a single Supabase round-trip. */
export const DEFAULT_READ_TIMEOUT_MS = 5_000;

/**
 * Extra time the outer race allows beyond the AbortSignal's deadline.
 *
 * The signal is the real mechanism — it cancels the socket, so the promise settles. The race is
 * only there in case it does not, and giving it a little slack means a request that aborts
 * normally is classified as a timeout by the signal rather than by the race, which keeps the
 * two paths from fighting over the same 5000ms boundary.
 */
const RACE_GRACE_MS = 250;

/** A read that could not be served. The `reason` is safe to return to the client; nothing else is. */
export class ReadUnavailableError extends Error {
  readonly reason: UnavailableReason;
  readonly missing: string[] | undefined;

  constructor(reason: UnavailableReason, options?: { missing?: string[]; cause?: unknown }) {
    super(`Read unavailable: ${reason}`, { cause: options?.cause });
    this.name = 'ReadUnavailableError';
    this.reason = reason;
    this.missing = options?.missing;
  }
}

/**
 * The service-role client, or a ReadUnavailableError if Supabase is not configured.
 *
 * Reads use the service-role key for the same reason GET /health/db does: there is no login
 * yet, so there is no user token to read on behalf of. RLS is enabled and dormant, and
 * service_role has BYPASSRLS — which is exactly why every query here filters on user_id
 * explicitly rather than trusting a policy that cannot fire.
 *
 * Throwing (rather than returning a union) is deliberate: routes are unusable without a client,
 * and the throw lands in the same handler as every other failure.
 */
export function getReadClient(): SupabaseAdminClient {
  const supabase = getSupabaseAdmin();
  if (!supabase.configured) {
    throw new ReadUnavailableError('missing_env', { missing: [...supabase.missing] });
  }
  return supabase.client;
}

/** The parts of a PostgREST response this module cares about. */
export interface PostgrestResult {
  data: unknown;
  error: unknown;
  status: number;
}

/** Server-side log fields for a PostgREST error. PostgREST error bodies carry no credentials. */
function describePostgrestError(error: unknown, status: number): Record<string, unknown> {
  const fields: Record<string, unknown> = { status };
  if (typeof error === 'object' && error !== null) {
    for (const key of ['code', 'message', 'details', 'hint'] as const) {
      if (key in error) fields[key] = (error as Record<string, unknown>)[key];
    }
  }
  return fields;
}

/**
 * Runs one PostgREST query under a deadline and returns its rows.
 *
 * `build` is handed an AbortSignal and must pass it to `.abortSignal()`, so a slow Supabase
 * releases the socket instead of pinning the Lambda open for the rest of its invocation budget.
 * Whether the deadline fired is read from `signal.aborted` rather than sniffed out of the error
 * message, because postgrest-js resolves (it does not reject) on abort, with status 0.
 */
export async function runQuery(
  build: (signal: AbortSignal) => PromiseLike<PostgrestResult>,
  context: string,
  timeoutMs: number = DEFAULT_READ_TIMEOUT_MS,
): Promise<UnknownRow[]> {
  const signal = AbortSignal.timeout(timeoutMs);

  const { data, error, status } = await withTimeout(
    Promise.resolve(build(signal)),
    timeoutMs + RACE_GRACE_MS,
  );

  if (error !== null && error !== undefined) {
    if (signal.aborted) {
      console.error(`${context} Supabase query timed out`, { timeoutMs });
      throw new ReadUnavailableError('timeout', { cause: error });
    }
    console.error(`${context} Supabase query failed`, describePostgrestError(error, status));
    throw new ReadUnavailableError('upstream_error', { cause: error });
  }

  return asRows(data);
}

/** Server-side log fields for any error. Never used to build a response body. */
function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: typeof error };
  const details: Record<string, unknown> = { name: error.name, message: error.message };
  if (error.cause instanceof Error) {
    details.cause = { name: error.cause.name, message: error.cause.message };
  }
  return details;
}

/**
 * Classifies anything thrown while serving a read into a ReadUnavailableError, logging the
 * detail that must not reach the client.
 */
export function toReadUnavailable(error: unknown, context: string): ReadUnavailableError {
  if (error instanceof ReadUnavailableError) return error;

  if (error instanceof TimeoutError) {
    console.error(`${context} read timed out`, describeError(error));
    return new ReadUnavailableError('timeout', { cause: error });
  }
  if (error instanceof SupabaseConfigError || error instanceof InvalidUserConfigError) {
    console.error(`${context} configuration is unusable`, describeError(error));
    return new ReadUnavailableError('invalid_config', { cause: error });
  }
  if (error instanceof RowShapeError) {
    // The view no longer matches src/types/database.ts. Fail loudly rather than serve a shape
    // the frontend's exhaustive switches cannot handle.
    console.error(`${context} unexpected row shape`, {
      field: error.field,
      ...describeError(error),
    });
    return new ReadUnavailableError('upstream_error', { cause: error });
  }

  console.error(`${context} unexpected read failure`, describeError(error));
  return new ReadUnavailableError('upstream_error', { cause: error });
}
