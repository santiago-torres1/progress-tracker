import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { Router } from 'express';

import { readEnv } from '../lib/env.js';
import { getSupabaseAdmin, SupabaseConfigError } from '../lib/supabase.js';
import { APP_VERSION } from '../lib/version.js';

export const DEFAULT_DB_PROBE_TIMEOUT_MS = 3_000;

export interface HealthRouterOptions {
  /** Upper bound on the /health/db Supabase round-trip. Overridable for tests. */
  dbProbeTimeoutMs?: number;
}

export type DbProbeFailure =
  | 'timeout' // no answer within the probe budget
  | 'unreachable' // network-level failure: DNS, TLS, connection refused
  | 'upstream_unavailable' // Supabase answered with a 5xx
  | 'key_rejected' // 401/403: reachable, but the service-role key was not accepted
  | 'upstream_error' // any other unexpected answer
  | 'invalid_config' // env vars present but unusable (e.g. malformed SUPABASE_URL)
  | 'probe_failed'; // anything else thrown while probing

class ProbeTimeoutError extends Error {
  constructor(ms: number) {
    super(`Supabase probe exceeded ${ms}ms`);
    this.name = 'ProbeTimeoutError';
  }
}

/**
 * Settles with `promise` or rejects after `ms`, whichever comes first. The underlying request is
 * not cancelled (supabase-js admin calls take no AbortSignal), but the HTTP response, and so the
 * Lambda invocation, is never held longer than `ms`. Promise.race keeps a handler attached to
 * `promise`, so a late rejection is not an unhandled rejection.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ProbeTimeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function classifyProbeFailure(error: unknown): DbProbeFailure {
  if (error instanceof ProbeTimeoutError) return 'timeout';
  if (error instanceof SupabaseConfigError) return 'invalid_config';
  if (isAuthError(error)) {
    if (error.status === 401 || error.status === 403) return 'key_rejected';
    // auth-js uses status 0 when fetch itself threw, and the 5xx status otherwise.
    if (isAuthRetryableFetchError(error)) {
      return error.status === 0 ? 'unreachable' : 'upstream_unavailable';
    }
    return 'upstream_error';
  }
  return 'probe_failed';
}

/** Server-side log fields for a probe failure. Error messages from auth-js/fetch carry no keys. */
function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: typeof error };
  const details: Record<string, unknown> = { name: error.name, message: error.message };
  if (isAuthError(error)) {
    details.status = error.status;
    details.code = error.code;
  }
  if (error.cause instanceof Error) {
    details.cause = { name: error.cause.name, message: error.cause.message };
  }
  return details;
}

export function createHealthRouter(options: HealthRouterOptions = {}): Router {
  const dbProbeTimeoutMs = options.dbProbeTimeoutMs ?? DEFAULT_DB_PROBE_TIMEOUT_MS;
  const router = Router();

  // Health responses describe this instant; nothing in between should cache them.
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Liveness: process is up and serving. Deliberately independent of Supabase.
  router.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      version: APP_VERSION,
      commit: readEnv('GIT_SHA') ?? 'local',
      timestamp: new Date().toISOString(),
    });
  });

  /*
   * Supabase wiring check: are the env vars present, and does a real authenticated round-trip
   * succeed?
   *
   * Probe: auth.admin.listUsers({ perPage: 1 }) with the service-role key. Chosen because:
   * - GoTrue's admin API exists on every Supabase project, including a brand-new one with zero
   *   tables, so the probe never depends on our schema.
   * - It only succeeds with a valid *service-role* key. A wrong, revoked, or anon key gets
   *   401/403, so success proves URL + key + network together, and failure is unambiguous.
   * - It needs no interpretation of "expected" errors (unlike querying a nonexistent table and
   *   treating "relation does not exist" as success). The one user record fetched is discarded.
   *
   * Status codes:
   * - unconfigured -> 200. Missing env vars is a legitimate state (local dev without a Supabase
   *   project), and this endpoint did its job by reporting it; a 5xx would look like a crash.
   *   Anything that requires a database should check `configured`, not just the status code.
   * - error -> 503. Supabase is configured but not usable right now; monitors should see that.
   * - ok -> 200.
   */
  router.get('/db', async (_req, res) => {
    const timestamp = new Date().toISOString();
    const startedAt = performance.now();
    const elapsedMs = (): number => Math.round(performance.now() - startedAt);

    try {
      const supabase = getSupabaseAdmin();
      if (!supabase.configured) {
        res.json({
          status: 'unconfigured',
          configured: false,
          reason: 'missing_env',
          missing: supabase.missing,
          timestamp,
        });
        return;
      }

      const { error } = await withTimeout(
        supabase.client.auth.admin.listUsers({ page: 1, perPage: 1 }),
        dbProbeTimeoutMs,
      );
      if (error) throw error;

      res.json({ status: 'ok', configured: true, latencyMs: elapsedMs(), timestamp });
    } catch (error) {
      const reason = classifyProbeFailure(error);
      console.error('[health/db] Supabase probe failed', { reason, ...describeError(error) });
      res.status(503).json({
        status: 'error',
        configured: true,
        reason,
        latencyMs: elapsedMs(),
        timestamp,
      });
    }
  });

  return router;
}
