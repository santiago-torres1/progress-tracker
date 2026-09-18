/*
 * Getting a visitor a session, and saying something honest while that happens.
 *
 * Nobody signs in here. The first visit mints an anonymous Supabase account in the background and
 * the app simply appears; the only visible states are "one moment" and, when it genuinely could
 * not, one calm paragraph that never suggests the visitor did anything wrong. All three of the
 * ways it can fail — Supabase unreachable, anonymous sign-ins turned off, the per-IP ceiling on
 * new accounts — are the project's business, not theirs.
 *
 * It also does the thing nothing else can: tells the server which time zone this browser is in.
 * The profile's zone decides which day a tick lands on, and it defaults to UTC, so without this a
 * visitor in New York ticking something off at eight in the evening records it against tomorrow.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createAuthStore, type AuthState, type AuthStore } from '../lib/auth';
import {
  fetchSession,
  updateSession,
  type ApiFailure,
  type ApiRequestOptions,
  type ApiResult,
} from '../lib/api';
import { failureCopy, signInFailureCopy } from '../lib/copy';
import {
  SessionContextProvider,
  type AppSession,
  type AuthorizedCall,
} from '../lib/sessionContext';
import { StatusNote } from '../screens/StatusNote';
import type { SessionProfile } from '../types/api';
import './SessionGate.css';

export interface SessionGateProps {
  children: ReactNode;
  /** Injected by the tests. Left out, the app builds its own from the Vite env. */
  store?: AuthStore;
  /** The zone to report. Overridable so a test is not at the mercy of the machine running it. */
  browserTimeZone?: string;
}

/** Where "the zone we have already told the server about" is remembered between visits. */
const ZONE_KEY = 'progress-tracker.time-zone.v1';

function readSentZone(): string | null {
  try {
    return globalThis.localStorage.getItem(ZONE_KEY);
  } catch {
    return null;
  }
}

function rememberSentZone(zone: string): void {
  try {
    globalThis.localStorage.setItem(ZONE_KEY, zone);
  } catch {
    // Storage blocked or absent: the PATCH simply happens again next visit, which is harmless —
    // it sets the same zone to the same value.
  }
}

function resolveBrowserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/** A profile read, stamped with the request that produced it. */
interface ProfileAnswer {
  attempt: number;
  call: AuthorizedCall;
  result: ApiResult<SessionProfile>;
}

/** The stand-in for "signed in, but somehow no profile" — a bug, rendered rather than thrown. */
const NO_SESSION: ApiFailure = { kind: 'failed', reason: 'network', status: null };

/**
 * Reads the profile, sending this browser's zone first when the server has not been told it.
 *
 * The PATCH failing must not cost the visitor their board: if it does, this falls back to a plain
 * GET and carries on with whatever zone the server already had. A wrong zone is a bug; a blank
 * page because setting the zone failed is a worse one.
 */
async function loadProfile(
  call: AuthorizedCall,
  browserZone: string,
  signal: AbortSignal,
): Promise<ApiResult<SessionProfile>> {
  if (readSentZone() !== browserZone) {
    const patched = await call(
      (options: ApiRequestOptions) => updateSession({ timeZone: browserZone }, options),
      signal,
    );
    if (patched.kind === 'ok') {
      rememberSentZone(browserZone);
      return { kind: 'ok', data: patched.data.session };
    }
  }

  const read = await call((options: ApiRequestOptions) => fetchSession(options), signal);
  return read.kind === 'ok' ? { kind: 'ok', data: read.data.session } : read;
}

/**
 * Subscribes to the auth store the React way, so a token refresh re-renders what depends on it.
 *
 * `useSyncExternalStore` rather than a `useState` kept in step by an effect: the store is exactly
 * the external thing this hook is for, and the effect version would set state during the effect
 * body — a cascading render, and a window in which the rendered state is already stale.
 */
function useAuthState(store: AuthStore): AuthState {
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const snapshot = useCallback(() => store.getState(), [store]);
  const state = useSyncExternalStore(subscribe, snapshot);

  useEffect(() => {
    store.start();
  }, [store]);

  return state;
}

export function SessionGate({ children, store, browserTimeZone }: SessionGateProps) {
  // Built once, and only when one was not supplied. A ref read during render would be a lie about
  // when the value exists; a lazy initialiser is the honest version of the same thing.
  const [ownStore] = useState(() => store ?? createAuthStore());
  const authStore = store ?? ownStore;

  const auth = useAuthState(authStore);
  const browserZone = browserTimeZone ?? resolveBrowserZone();

  /*
   * The profile read, stamped with the question it answers.
   *
   * "Loading" is derived rather than stored — it is simply "the answer on hand is not the answer
   * to the question now being asked". That keeps the effect free of a synchronous setState, and
   * means a stale profile can never be shown for a render after the session changed. It is the
   * same shape `useApiResource` uses, for the same reason.
   */
  const [answer, setAnswer] = useState<ProfileAnswer | null>(null);
  const [attempt, setAttempt] = useState(0);

  const call = useCallback<AuthorizedCall>(
    async (run, signal) => {
      const token = await authStore.getToken();
      if (token === null) return { kind: 'unauthenticated', reason: null };
      return run({ accessToken: token, signal });
    },
    [authStore],
  );

  const signedIn = auth.status === 'signed-in';

  useEffect(() => {
    if (!signedIn) return;

    const controller = new AbortController();

    loadProfile(call, browserZone, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setAnswer({ attempt, call, result });
      })
      .catch(() => {
        // Only reachable when this effect was cleaned up mid-flight.
      });

    return () => {
      controller.abort();
    };
  }, [signedIn, call, browserZone, attempt]);

  const reloadProfile = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);

  const current =
    answer !== null && answer.attempt === attempt && answer.call === call ? answer.result : null;

  const session = useMemo<AppSession | null>(
    () => (current?.kind === 'ok' ? { call, profile: current.data, reloadProfile } : null),
    [current, call, reloadProfile],
  );

  if (auth.status === 'unavailable') {
    const copy = signInFailureCopy(auth.reason);
    return (
      <div className="session-gate">
        <StatusNote
          state="failure"
          title={copy.title}
          body={copy.body}
          onRetry={() => {
            authStore.retry();
          }}
        />
      </div>
    );
  }

  if (auth.status === 'signing-in' || current === null) {
    return (
      <div className="session-gate">
        <StatusNote state="loading" title="Getting your board ready…" />
      </div>
    );
  }

  if (current.kind !== 'ok' || session === null) {
    const copy = failureCopy(current.kind === 'ok' ? NO_SESSION : current);
    return (
      <div className="session-gate">
        <StatusNote state="failure" title={copy.title} body={copy.body} onRetry={reloadProfile} />
      </div>
    );
  }

  return <SessionContextProvider value={session}>{children}</SessionContextProvider>;
}
