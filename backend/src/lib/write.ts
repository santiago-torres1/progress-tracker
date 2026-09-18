import { ReadUnavailableError, type PostgrestResult } from './read.js';
import { asRows, type UnknownRow } from './row.js';
import { withTimeout } from './timeout.js';
import type { ApiErrorResponse, ConflictReason, NotFoundReason } from '../types/api.js';

/*
 * Running a write, and turning what comes back from a refusal into a status code.
 *
 * The read path has exactly one failure (lib/read.ts: it is unavailable, here is a short reason,
 * 503). A write has several, and most of them are the caller's, not ours: the account is at its
 * goal cap, the id names somebody else's goal, the goal is not a measured one. Those are 4xx and
 * a client can act on them, so they are separated here from the 5xx the read path already knows.
 *
 * THE RULE ABOUT WHAT REACHES THE CLIENT is the same rule as everywhere else: a short code this
 * API defines, never an upstream message. PostgreSQL's own text is useful and dangerous in equal
 * measure — `duplicate key value violates unique constraint "calendar_entries_recurrence_day_uidx"`
 * names another account's row indirectly, and a CHECK violation names internal constraints. So
 * the detail is logged and the body carries a token from the fixed vocabulary below.
 *
 * The one value that IS passed through is the cap name on `limit_reached`, and only after being
 * matched against USAGE_LIMITS: it comes from public.raise_limit_reached(), which puts a fixed
 * name and nothing else in DETAIL, and the UI needs it to say which limit was reached.
 */

/** Extra time the outer race allows beyond the AbortSignal, matching lib/read.ts. */
const RACE_GRACE_MS = 250;

/** Upper bound on a single write round-trip. Writes are one statement; the budget is the read's. */
export const DEFAULT_WRITE_TIMEOUT_MS = 5_000;

/**
 * The caps in public.usage_limit(), by name.
 *
 * An allowlist rather than a pass-through: DETAIL is only ever one of these today, and keeping
 * the check means a future constraint that raises with something else in DETAIL cannot turn that
 * into a response body.
 */
export const USAGE_LIMITS = [
  'goals_per_user',
  'calendar_entries_per_goal',
  'calendar_entries_without_goal_per_user',
  'progress_entries_per_goal',
  'recurrences_per_goal',
  'life_areas_per_user',
] as const;

/** The machine tokens the write RPCs raise, mapped to what the caller could not find. */
const NOT_FOUND_TOKENS: Record<string, NotFoundReason> = {
  goal_not_found: 'goal',
  entry_not_found: 'entry',
  recurrence_not_found: 'recurrence',
  // A batch where some id matched nothing the caller owns. Nothing was applied.
  layout_mismatch: 'goal',
};

/** Tokens that mean "the request is fine but the state is not". */
const CONFLICT_TOKENS: Record<string, ConflictReason> = {
  wrong_goal_kind: 'wrong_goal_kind',
};

/** A write the caller could fix. Carries the exact status and body the route will send. */
export class WriteRejectedError extends Error {
  readonly status: number;
  readonly body: ApiErrorResponse;

  constructor(status: number, body: ApiErrorResponse, options?: ErrorOptions) {
    super(`Write rejected: ${body.error}`, options);
    this.name = 'WriteRejectedError';
    this.status = status;
    this.body = body;
  }
}

interface PostgresErrorFields {
  code: string | undefined;
  message: string | undefined;
  details: string | undefined;
}

/** Reads the fields PostgREST puts on an error, without trusting any of them to exist. */
function errorFields(error: unknown): PostgresErrorFields {
  const read = (key: string): string | undefined => {
    if (typeof error !== 'object' || error === null || !(key in error)) return undefined;
    const value: unknown = (error as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  };
  return { code: read('code'), message: read('message'), details: read('details') };
}

/** Server-side log fields. Never used to build a response body. */
function describe(error: unknown, status: number): Record<string, unknown> {
  const { code, message, details } = errorFields(error);
  return { status, code, message, details };
}

function isUsageLimit(name: string | undefined): name is (typeof USAGE_LIMITS)[number] {
  return USAGE_LIMITS.some((limit): boolean => limit === name);
}

/**
 * Classifies a PostgREST error into something the caller is allowed to see, or `undefined` when
 * it is ours to own as a 503.
 *
 * The order matters: `limit_reached` is a check_violation, so it has to be recognised before the
 * generic 23514 case turns every cap into "that combination of fields is not allowed".
 */
export function classifyWriteError(error: unknown): WriteRejectedError | undefined {
  const { code, message, details } = errorFields(error);

  // A cap, raised by public.raise_limit_reached(). DETAIL is the cap's name and nothing else.
  if (code === '23514' && message === 'limit_reached') {
    const body: ApiErrorResponse = { error: 'limit_reached' };
    if (isUsageLimit(details)) body.limit = details;
    return new WriteRejectedError(409, body, { cause: error });
  }

  if (message !== undefined) {
    const notFound = NOT_FOUND_TOKENS[message];
    if (notFound !== undefined) {
      return new WriteRejectedError(
        404,
        { error: 'not_found', reason: notFound },
        { cause: error },
      );
    }
    const conflict = CONFLICT_TOKENS[message];
    if (conflict !== undefined) {
      return new WriteRejectedError(409, { error: 'conflict', reason: conflict }, { cause: error });
    }
  }

  switch (code) {
    // A CHECK the boundary validation did not catch: a habit field on a scheduled goal, a title
    // of 201 characters. The response says so without naming the constraint.
    case '23514':
      return new WriteRejectedError(
        400,
        {
          error: 'invalid_request',
          message: 'Those values are not a shape this goal can have.',
        },
        { cause: error },
      );

    // A unique index. Today that is only "there is already a check-in on that day".
    case '23505':
      return new WriteRejectedError(
        409,
        { error: 'conflict', reason: 'duplicate' },
        { cause: error },
      );

    // A foreign key: an id that names a row this account does not hold — a life area, or a goal
    // reached through a composite (child, user_id) key. Which one is deliberately not said.
    case '23503':
      return new WriteRejectedError(
        400,
        {
          error: 'invalid_reference',
          message: 'One of the ids in that request does not belong to this account.',
        },
        { cause: error },
      );

    // A policy refused the row. The routes take user_id from the session, so this should be
    // unreachable; it is mapped rather than hidden so it surfaces as 403 and not as an outage.
    case '42501':
      return new WriteRejectedError(403, { error: 'forbidden' }, { cause: error });

    default:
      return undefined;
  }
}

/**
 * Runs one write under a deadline and returns the rows it produced.
 *
 * Identical plumbing to lib/read.ts's runQuery — the same AbortSignal, the same race, the same
 * `signal.aborted` check rather than sniffing the error, because postgrest-js resolves on abort
 * instead of rejecting — with the classification above bolted on. Callers get either rows, a
 * WriteRejectedError they can render verbatim, or a ReadUnavailableError for the 503 path.
 */
export async function runWrite(
  build: (signal: AbortSignal) => PromiseLike<PostgrestResult>,
  context: string,
  timeoutMs: number = DEFAULT_WRITE_TIMEOUT_MS,
): Promise<UnknownRow[]> {
  const signal = AbortSignal.timeout(timeoutMs);

  const { data, error, status } = await withTimeout(
    Promise.resolve(build(signal)),
    timeoutMs + RACE_GRACE_MS,
  );

  if (error !== null && error !== undefined) {
    if (signal.aborted) {
      console.error(`${context} Supabase write timed out`, { timeoutMs });
      throw new ReadUnavailableError('timeout', { cause: error });
    }

    const rejected = classifyWriteError(error);
    if (rejected !== undefined) {
      // Logged in full, answered with a code. The two halves are deliberately different.
      console.warn(`${context} write refused`, describe(error, status));
      throw rejected;
    }

    console.error(`${context} Supabase write failed`, describe(error, status));
    throw new ReadUnavailableError('upstream_error', { cause: error });
  }

  return asRows(data);
}

/**
 * The single row a write was meant to touch.
 *
 * No rows means the statement matched nothing the caller can see — which, under row-level
 * security, is the same answer for "it never existed", "it is already deleted" and "it belongs
 * to somebody else". All three are a 404 that says only what was not found.
 */
export function requireRow(rows: UnknownRow[], reason: NotFoundReason): UnknownRow {
  const row = rows[0];
  if (row === undefined) {
    throw new WriteRejectedError(404, { error: 'not_found', reason });
  }
  return row;
}
