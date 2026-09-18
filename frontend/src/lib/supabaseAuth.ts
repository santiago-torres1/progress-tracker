/*
 * Anonymous sign-in, spoken directly to Supabase Auth (GoTrue) over HTTPS.
 *
 * WHY NOT @supabase/supabase-js. The browser needs exactly three things from Supabase: mint an
 * anonymous account, swap a refresh token for a fresh access token, and keep the result between
 * visits. It never queries a table, opens a realtime socket, uploads a file or invokes a function
 * — every read and write goes through our own API, because that is what makes row-level security
 * the thing doing the isolating. Pulling in the whole SDK for three POSTs would ship postgrest-js,
 * realtime-js, storage-js and functions-js to every visitor for nothing.
 *
 * The seam is deliberate and narrow: `AuthTransport` below is the entire surface the rest of the
 * app sees, and `httpTransport` is the only thing that knows what GoTrue looks like. Swapping in
 * the SDK later means reimplementing two methods in one file and changing nothing else.
 *
 * Two rules it keeps:
 *
 * 1. It never throws for an expected failure. Supabase unreachable, anonymous sign-ins turned off
 *    and the per-IP rate limit are all results, because each of them wants different words on
 *    screen and none of them is the visitor's fault.
 * 2. It stores a token, never a secret. The anon key is public by design (it is in the bundle
 *    either way) and the access token is the visitor's own.
 */

/** A signed-in session, reduced to what this app actually uses. */
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Epoch seconds. The token is swapped before this, never after. */
  expiresAt: number;
}

/**
 * Why signing in did not work.
 *
 * Kept apart because they deserve different sentences: `not_configured` is a build that was never
 * given its Supabase URL, `disabled` is anonymous sign-ins turned off in the project, and
 * `rate_limited` is Supabase's own per-IP ceiling on minting accounts — which the visitor may well
 * have hit through no doing of their own, on a shared network.
 */
export type AuthFailureReason =
  'not_configured' | 'disabled' | 'rate_limited' | 'network' | 'upstream';

export type AuthAttempt =
  { kind: 'ok'; session: AuthSession } | { kind: 'failed'; reason: AuthFailureReason };

/** Everything the app needs from an identity provider. Two methods, both total. */
export interface AuthTransport {
  signInAnonymously(signal?: AbortSignal): Promise<AuthAttempt>;
  refresh(refreshToken: string, signal?: AbortSignal): Promise<AuthAttempt>;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/**
 * The project this build talks to, or null when it was built without one.
 *
 * Null is an ordinary state, not a crash: a preview build with no Supabase project should still
 * render and say so calmly rather than show a blank page.
 */
export interface SupabaseEnv {
  readonly VITE_SUPABASE_URL?: string | undefined;
  readonly VITE_SUPABASE_ANON_KEY?: string | undefined;
}

export function readSupabaseConfig(env: SupabaseEnv = import.meta.env): SupabaseConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (url === undefined || url === '' || anonKey === undefined || anonKey === '') return null;

  return { url: url.replace(/\/+$/, ''), anonKey };
}

const REQUEST_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A GoTrue token payload as a session, or null if it is not one.
 *
 * `expires_at` is preferred when present and derived from `expires_in` when it is not, so a clock
 * that disagrees with the server by a few seconds still refreshes in time.
 */
export function parseTokenPayload(body: unknown, nowMs: number): AuthSession | null {
  if (!isRecord(body)) return null;

  const accessToken = body.access_token;
  const refreshToken = body.refresh_token;
  if (typeof accessToken !== 'string' || accessToken === '') return null;
  if (typeof refreshToken !== 'string' || refreshToken === '') return null;

  const nowSeconds = Math.floor(nowMs / 1000);
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  const expiresAt =
    typeof body.expires_at === 'number' ? body.expires_at : nowSeconds + Math.floor(expiresIn);

  return { accessToken, refreshToken, expiresAt };
}

/**
 * Which failure a GoTrue response describes.
 *
 * Supabase says "anonymous sign-ins are disabled" with a 422 and an `error_code`, and its rate
 * limit with a 429. Everything else is ours to own as `upstream` — the body is never shown to
 * anyone, because an auth error message is exactly the sort of thing that leaks configuration.
 */
function classify(status: number, body: unknown): AuthFailureReason {
  if (status === 429) return 'rate_limited';

  const code = isRecord(body) && typeof body.error_code === 'string' ? body.error_code : '';
  if (code === 'anonymous_provider_disabled' || code === 'signup_disabled') return 'disabled';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
    return 'rate_limited';
  }
  if (status === 422 || status === 403) return 'disabled';
  return 'upstream';
}

/** GoTrue over `fetch`. The only place in the app that knows Supabase's own URL shape. */
export function httpTransport(
  config: SupabaseConfig,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): AuthTransport {
  async function post(path: string, body: unknown, signal?: AbortSignal): Promise<AuthAttempt> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetchImpl(`${config.url}${path}`, {
        method: 'POST',
        signal: combined,
        headers: {
          apikey: config.anonKey,
          authorization: `Bearer ${config.anonKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      return { kind: 'failed', reason: 'network' };
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // A body that is not JSON is handled below as an unusable one.
    }

    if (!response.ok) {
      return { kind: 'failed', reason: classify(response.status, payload) };
    }

    const session = parseTokenPayload(payload, now());
    return session === null ? { kind: 'failed', reason: 'upstream' } : { kind: 'ok', session };
  }

  return {
    signInAnonymously(signal) {
      // The same call `signInAnonymously()` makes: a signup with no credentials on it.
      return post('/auth/v1/signup', { data: {} }, signal);
    },
    refresh(refreshToken, signal) {
      const path = '/auth/v1/token?grant_type=refresh_token';
      return post(path, { refresh_token: refreshToken }, signal);
    },
  };
}

// --- Persistence ------------------------------------------------------------------------------

const STORAGE_KEY = 'progress-tracker.auth.v1';

/**
 * The parts of `Storage` this needs, so a test can hand it a map and a private-mode browser that
 * throws on write does not take the app down with it.
 */
export interface SessionStore {
  read(): AuthSession | null;
  write(session: AuthSession): void;
  clear(): void;
  /**
   * Tells the caller that another tab wrote here, when the store has siblings at all.
   *
   * Optional on purpose: a memory store is one tab's private variable and can never change behind
   * anyone's back, so it has nothing to offer and says so by not implementing this.
   */
  subscribe?(onChange: () => void): () => void;
}

function parseStored(raw: string): AuthSession | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const { accessToken, refreshToken, expiresAt } = parsed;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') return null;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;

  return { accessToken, refreshToken, expiresAt };
}

/**
 * `localStorage`, with every access wrapped.
 *
 * Safari in private mode throws on `setItem`, and a browser with storage blocked throws on read.
 * Neither should stop someone using the app — they just get a new anonymous account next visit,
 * which is a smaller loss than a white screen.
 */
/**
 * `globalThis.localStorage`, typed as the optional thing it really is.
 *
 * The DOM lib declares it as always present. It is not: a sandboxed iframe has none at all, and a
 * browser with storage disabled throws on the first touch. Widening it here is what lets the check
 * below be a real check rather than dead code the linter is right to complain about.
 */
function browserStorage(): Storage | undefined {
  return (globalThis as { localStorage?: Storage }).localStorage;
}

/**
 * The window, when there is one to listen on.
 *
 * `storage` events are a window thing, and this module runs in tests and could run in a worker,
 * where there is no window and therefore no sibling tab to hear from either.
 */
function eventTarget(): Window | undefined {
  return (globalThis as { window?: Window }).window;
}

export function localSessionStore(storage: Storage | undefined = browserStorage()): SessionStore {
  if (storage === undefined) return memorySessionStore();

  return {
    read() {
      try {
        const raw = storage.getItem(STORAGE_KEY);
        return raw === null ? null : parseStored(raw);
      } catch {
        return null;
      }
    },
    write(session) {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(session));
      } catch {
        // Safari in private mode throws here. The session still works for this tab; the visitor
        // simply gets a new anonymous account next time, which beats a white screen.
      }
    },
    clear() {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch {
        // As above.
      }
    },
    /**
     * Fires when another tab writes the session — never for this tab's own writes, which is
     * exactly the semantics wanted: the only interesting change is somebody else's.
     */
    subscribe(onChange) {
      const target = eventTarget();
      if (target === undefined) return () => undefined;

      const listener = (event: StorageEvent): void => {
        // A null key is `localStorage.clear()`, which takes our key with it.
        if (event.key !== null && event.key !== STORAGE_KEY) return;
        onChange();
      };
      target.addEventListener('storage', listener);
      return () => {
        target.removeEventListener('storage', listener);
      };
    },
  };
}

/** A store that forgets on reload. The fallback when there is no `localStorage` at all. */
export function memorySessionStore(): SessionStore {
  let held: AuthSession | null = null;
  return {
    read: () => held,
    write: (session) => {
      held = session;
    },
    clear: () => {
      held = null;
    },
  };
}
