/**
 * Client for the backend's infrastructure health endpoint.
 * This is alpha plumbing only — it proves the frontend can reach the deployed backend.
 */

export interface HealthPayload {
  status: 'ok';
  version: string;
  commit: string;
  timestamp: string;
}

export type HealthResult =
  | { kind: 'pass'; payload: HealthPayload; latencyMs: number }
  | { kind: 'fail'; reason: string; latencyMs: number };

const DEFAULT_TIMEOUT_MS = 8000;

/** Joins the configured API base URL with a path. An empty base means same-origin. */
export function apiUrl(
  path: string,
  base: string = import.meta.env.VITE_API_BASE_URL ?? '',
): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

function isHealthPayload(value: unknown): value is HealthPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.status === 'ok' &&
    typeof v.version === 'string' &&
    typeof v.commit === 'string' &&
    typeof v.timestamp === 'string'
  );
}

interface FetchHealthOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Calls GET /health. Never throws for network or HTTP failures — those become a `fail`
 * result so the UI can render them. Rethrows only when the caller's own signal aborts.
 */
export async function fetchHealth({
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
}: FetchHealthOptions = {}): Promise<HealthResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  try {
    const response = await fetchImpl(apiUrl('/health'), {
      signal: combined,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      return { kind: 'fail', reason: `HTTP ${String(response.status)}`, latencyMs: elapsed() };
    }
    const body: unknown = await response.json().catch(() => null);
    if (!isHealthPayload(body)) {
      return { kind: 'fail', reason: 'Unexpected response shape', latencyMs: elapsed() };
    }
    return { kind: 'pass', payload: body, latencyMs: elapsed() };
  } catch (error) {
    if (signal?.aborted) throw error;
    const reason = timeout.aborted ? `Timed out after ${String(timeoutMs)}ms` : 'Network error';
    return { kind: 'fail', reason, latencyMs: elapsed() };
  }
}
