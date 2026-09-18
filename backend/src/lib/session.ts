import { ReadUnavailableError } from './read.js';
import {
  asRows,
  readBoolean,
  readInstant,
  readInteger,
  readOptionalInstant,
  readString,
} from './row.js';
import { createUserClient, readSupabaseConfig, type SupabaseUserClient } from './supabase.js';
import { withTimeout } from './timeout.js';
import type { AuthReason } from '../types/api.js';

/*
 * Who is calling, and may they.
 *
 * Every /api request carries `Authorization: Bearer <supabase access token>`, minted by
 * Supabase anonymous sign-in in the browser. This module turns that header into a Session:
 * a client that acts as that user, plus the profile fields the routes need.
 *
 * WHAT VERIFIES THE TOKEN: not this file. PostgREST checks the signature against the project's
 * key before running anything, so a forged, expired or tampered token never reaches
 * public.begin_request() and comes back as a 401 from Supabase. The backend therefore needs no
 * JWT secret and does no crypto — one fewer place to get signature verification subtly wrong.
 * Nothing below ever trusts a value read out of the token.
 */

/** Upper bound on the session round-trip, matching the read budget in read.ts. */
export const DEFAULT_SESSION_TIMEOUT_MS = 5_000;

/** Extra slack for the outer race; the AbortSignal is the real mechanism. See read.ts. */
const RACE_GRACE_MS = 250;

/** Which quota the request is charged against. Writes arrive in Phase 2. */
export type RequestKind = 'read' | 'write';

/** The caller could not be identified. `reason` is safe to return; nothing else is. */
export class UnauthorizedError extends Error {
  readonly reason: AuthReason;

  constructor(reason: AuthReason, options?: ErrorOptions) {
    super(`Unauthorized: ${reason}`, options);
    this.name = 'UnauthorizedError';
    this.reason = reason;
  }
}

/** The caller is known but over quota. */
export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Rate limited');
    this.name = 'RateLimitedError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** One request's identity. Created per request, never cached, never logged. */
export interface Session {
  /** public.users.id — the row every goal, entry and check-in hangs off. */
  userId: string;
  displayName: string;
  /** IANA zone; defines what "today" means for this person's habit periods. */
  timeZone: string;
  /** ISO day the week starts on, 1 = Monday. */
  weekStartsOn: number;
  /** True while this is a throwaway anonymous account that has not been converted. */
  isAnonymous: boolean;
  lastSeenAt: string;
  /** When an unused anonymous account is deleted. Null once the account is permanent. */
  expiresAt: string | null;
  /** Acts as this user: RLS, not our filters, decides which rows they see. */
  client: SupabaseUserClient;
}

/**
 * A JWS compact serialisation: three base64url segments. This is a SHAPE check, not a
 * verification — it exists so an obviously junk header costs nothing, and so the 401 the caller
 * gets says which of the two mistakes they made. A well-formed forgery passes it and is then
 * rejected by Supabase, which is the check that counts.
 */
const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;

/**
 * Pulls the access token out of an Authorization header.
 *
 * Throws rather than returning undefined: a product route cannot proceed without one, and the
 * throw lands in the same place as every other auth failure.
 */
export function readBearerToken(header: string | undefined): string {
  if (header === undefined || header.trim() === '') {
    throw new UnauthorizedError('missing_token');
  }

  // RFC 9110: the scheme is case-insensitive.
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  if (token === undefined || !JWT_SHAPE.test(token)) {
    throw new UnauthorizedError('malformed_token');
  }
  return token;
}

/** The parts of a PostgREST response this module cares about. */
interface RpcResult {
  data: unknown;
  error: unknown;
  status: number;
}

/**
 * Runs the session RPC under a deadline.
 *
 * The indirection is the same one lib/read.ts uses, and for the same reason: without generated
 * database types, `client.rpc(...)` resolves to `any`, and taking the call as a
 * `PromiseLike<RpcResult>` parameter is what narrows it at the boundary instead of spraying
 * unchecked values through the module.
 */
function runRpc(
  build: (signal: AbortSignal) => PromiseLike<RpcResult>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<RpcResult> {
  return withTimeout(Promise.resolve(build(signal)), timeoutMs + RACE_GRACE_MS);
}

/** Server-side log fields. PostgREST error bodies carry no credentials, but never the token. */
function describeRpcError(error: unknown, status: number): Record<string, unknown> {
  const fields: Record<string, unknown> = { status };
  if (typeof error === 'object' && error !== null) {
    for (const key of ['code', 'message', 'details', 'hint'] as const) {
      if (key in error) fields[key] = (error as Record<string, unknown>)[key];
    }
  }
  return fields;
}

/**
 * Resolves the caller's session in one Supabase round trip.
 *
 * public.begin_request() does four things in that one call — proves the token maps to a
 * profile, charges the request against this account's quota, refreshes last_seen_at at most
 * once a day, and returns the profile. Splitting them would be four network hops per request on
 * a Lambda that is already paying for one.
 *
 * Failure mapping, and what each hides:
 *   * Supabase answers 401/403  -> `invalid_token`. Never the upstream message: it can name the
 *     claim that failed, which tells an attacker how to get closer.
 *   * No row comes back         -> `no_profile`. Means "verified, but unusable here"; the
 *     database deliberately cannot tell us whether the subject exists.
 *   * retry_after_seconds > 0   -> RateLimitedError, rendered as 429.
 *   * anything else             -> ReadUnavailableError, rendered as 503, same as any read.
 */
export async function resolveSession(
  accessToken: string,
  kind: RequestKind = 'read',
  timeoutMs: number = DEFAULT_SESSION_TIMEOUT_MS,
): Promise<Session> {
  const config = readSupabaseConfig();
  if (!config.configured) {
    throw new ReadUnavailableError('missing_env', { missing: [...config.missing] });
  }

  const client = createUserClient(config.credentials, accessToken);
  const signal = AbortSignal.timeout(timeoutMs);

  const { data, error, status } = await runRpc(
    (abort) => client.rpc('begin_request', { p_kind: kind }).abortSignal(abort),
    signal,
    timeoutMs,
  );

  if (error !== null && error !== undefined) {
    if (signal.aborted) {
      console.error('[session] begin_request timed out', { timeoutMs });
      throw new ReadUnavailableError('timeout', { cause: error });
    }
    if (status === 401 || status === 403) {
      // Logged at info level detail, but the response says only `invalid_token`.
      console.error(
        '[session] Supabase rejected the access token',
        describeRpcError(error, status),
      );
      throw new UnauthorizedError('invalid_token', { cause: error });
    }
    console.error('[session] begin_request failed', describeRpcError(error, status));
    throw new ReadUnavailableError('upstream_error', { cause: error });
  }

  const rows = asRows(data);
  const row = rows[0];
  if (row === undefined) throw new UnauthorizedError('no_profile');

  const retryAfterSeconds = readInteger(row, 'retry_after_seconds');
  if (retryAfterSeconds > 0) throw new RateLimitedError(retryAfterSeconds);

  return {
    userId: readString(row, 'user_id'),
    displayName: readString(row, 'display_name'),
    timeZone: readString(row, 'time_zone'),
    weekStartsOn: readInteger(row, 'week_starts_on'),
    isAnonymous: readBoolean(row, 'is_anonymous'),
    lastSeenAt: readInstant(row, 'last_seen_at'),
    expiresAt: readOptionalInstant(row, 'expires_at'),
    client,
  };
}
