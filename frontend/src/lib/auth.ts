/*
 * Who the visitor is, before they have told us anything.
 *
 * There is no sign-in screen in this release and there is not meant to be one: the first visit
 * mints an anonymous Supabase account in the background, and from then on every /api request
 * carries that account's access token. The app is unusable without it — the backend answers 401 to
 * an unauthenticated request — so this is the one piece of loading the page genuinely has to wait
 * for, and the one failure it has to say something about.
 *
 * The store below is deliberately framework-free: a snapshot, a subscription and three commands.
 * React reads it through `useSyncExternalStore`, and the tests drive it directly.
 */

import {
  httpTransport,
  localSessionStore,
  readSupabaseConfig,
  type AuthFailureReason,
  type AuthSession,
  type AuthTransport,
  type SessionStore,
} from './supabaseAuth';

/**
 * The three honest states, and no fourth.
 *
 * `unavailable` is not an error state in the UI sense — nothing about it is the visitor's doing,
 * and the copy that renders it says so. It carries the reason because "anonymous accounts are
 * turned off for this project" and "too many new accounts from this network just now" want
 * genuinely different sentences.
 */
export type AuthState =
  | { status: 'signing-in' }
  | { status: 'signed-in'; accessToken: string; fresh: boolean }
  | { status: 'unavailable'; reason: AuthFailureReason };

export interface AuthStore {
  getState(): AuthState;
  subscribe(listener: () => void): () => void;
  /** Starts (or resumes) sign-in. Safe to call more than once; the second call is a no-op. */
  start(): void;
  /** After a failure, try again — from a button a person pressed, never on a timer. */
  retry(): void;
  /**
   * A token that is good for the next request, refreshing first if it is about to lapse.
   * Null when there is no session to be had; the caller renders the unavailable state.
   */
  getToken(): Promise<string | null>;
  /** Stops the refresh timer and the cross-tab listener. For tests and for a root that unmounts. */
  stop(): void;
}

/** Swap a token this long before it lapses, so a request in flight never carries a dead one. */
const REFRESH_MARGIN_SECONDS = 60;

/** How long to wait before a second go at a refresh that failed on the network. */
const REFRESH_RETRY_MS = 30_000;

/**
 * How many refresh tokens one attempt will try before it stops.
 *
 * Supabase rotates refresh tokens: a successful refresh spends the token it was given. Two tabs
 * refreshing at once therefore means one of them gets refused holding a token its sibling has
 * already swapped — and the session it should be using is sitting in storage. Re-reading and
 * trying again covers that, and covers it happening twice in a row; past three there is something
 * properly wrong upstream and another go would only be noise.
 */
const MAX_REFRESH_ATTEMPTS = 3;

export interface AuthStoreOptions {
  transport?: AuthTransport | null;
  store?: SessionStore;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

/** The same session, as far as anything here cares: same token to send, same token to swap. */
function sameSession(a: AuthSession, b: AuthSession): boolean {
  return a.accessToken === b.accessToken && a.refreshToken === b.refreshToken;
}

function defaultTransport(): AuthTransport | null {
  const config = readSupabaseConfig();
  return config === null ? null : httpTransport(config);
}

/** `localSessionStore` falls back to memory on its own when there is no usable storage. */
function defaultStore(): SessionStore {
  return localSessionStore();
}

/**
 * The sign-in state machine.
 *
 * The sequence on a cold start is: restore what is in storage, refresh it if it has lapsed, and
 * mint a new anonymous account only when there is nothing usable left. That order matters — a
 * visitor who comes back after a fortnight keeps their goals, because their refresh token still
 * works long after their access token stopped.
 *
 * The one invariant everything here serves: a refused refresh must never quietly cost somebody
 * goals that are still reachable. Because Supabase rotates refresh tokens, "refused" usually
 * means a sibling tab got there first, and the session that replaced this one is in storage. So
 * storage is re-read before any conclusion is drawn from a refusal, and a new anonymous account —
 * which strands every row the old one owns — is only ever the last resort.
 */
export function createAuthStore(options: AuthStoreOptions = {}): AuthStore {
  const transport = options.transport === undefined ? defaultTransport() : options.transport;
  const store = options.store ?? defaultStore();
  const now = options.now ?? Date.now;

  function setTimer(run: () => void, ms: number): ReturnType<typeof setTimeout> {
    return options.setTimer === undefined ? setTimeout(run, ms) : options.setTimer(run, ms);
  }

  function clearTimer(handle: ReturnType<typeof setTimeout>): void {
    if (options.clearTimer === undefined) clearTimeout(handle);
    else options.clearTimer(handle);
  }

  let state: AuthState = { status: 'signing-in' };
  let session: AuthSession | null = null;
  let inFlight: Promise<string | null> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let started = false;

  const listeners = new Set<() => void>();

  function publish(next: AuthState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  function secondsNow(): number {
    return Math.floor(now() / 1000);
  }

  function expiringSoon(held: AuthSession): boolean {
    return held.expiresAt - REFRESH_MARGIN_SECONDS <= secondsNow();
  }

  function cancelTimer(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  /** Swap the token a minute before it lapses, so nothing ever races the expiry. */
  function scheduleRefresh(held: AuthSession): void {
    cancelTimer();
    const dueMs = Math.max(0, (held.expiresAt - REFRESH_MARGIN_SECONDS) * 1000 - now());
    timer = setTimer(() => {
      void getToken();
    }, dueMs);
  }

  /** Take a session as ours without writing it back — for one that came out of the store. */
  function hold(held: AuthSession, fresh: boolean): string {
    session = held;
    publish({ status: 'signed-in', accessToken: held.accessToken, fresh });
    scheduleRefresh(held);
    return held.accessToken;
  }

  function adopt(held: AuthSession, fresh: boolean): string {
    store.write(held);
    return hold(held, fresh);
  }

  /**
   * The best session anyone knows about: ours, or the one a sibling tab has written since.
   *
   * Later expiry wins, because that is precisely "whoever refreshed most recently". Ours wins a
   * tie, so a browser that silently refuses writes (private-mode Safari) does not flap between
   * the session it is using and an older one it failed to overwrite.
   */
  function bestKnown(): AuthSession | null {
    const stored = store.read();
    if (session === null) return stored;
    if (stored === null) return session;
    return stored.expiresAt > session.expiresAt ? stored : session;
  }

  /**
   * Forget a session that is genuinely spent — but only if it is still the one on record.
   *
   * Clearing unconditionally is how one tab deletes another tab's freshly refreshed session, and
   * with it the only route back to that account's goals.
   */
  function discard(spent: AuthSession): void {
    const stored = store.read();
    if (stored === null || sameSession(stored, spent)) store.clear();
    if (session !== null && sameSession(session, spent)) session = null;
  }

  function giveUp(reason: AuthFailureReason): null {
    session = null;
    cancelTimer();
    publish({ status: 'unavailable', reason });
    return null;
  }

  /**
   * Gets a usable token, doing the least work that will produce one.
   *
   * Everything funnels through here — the first sign-in, the scheduled refresh and any caller that
   * needs a token right now — and `inFlight` makes concurrent callers share one attempt. Two tiles
   * tapped at the same moment must not mint two accounts.
   *
   * The loop is what makes two tabs safe. A refused refresh is not proof that the account is out
   * of reach: far more often it means a sibling tab spent the token a second earlier and left the
   * session that replaced it in storage. So a refusal re-reads the store, and if what is there is
   * not what was just tried, that gets a go before anything else. Minting a new anonymous account
   * is the last thing this function will do, never the second.
   */
  async function resolve(): Promise<string | null> {
    if (transport === null) return giveUp('not_configured');

    let held = bestKnown();

    for (let attempt = 0; held !== null && attempt < MAX_REFRESH_ATTEMPTS; attempt += 1) {
      if (!expiringSoon(held)) {
        const current = session;
        return state.status === 'signed-in' && current !== null && sameSession(current, held)
          ? held.accessToken
          : adopt(held, false);
      }

      const refreshed = await transport.refresh(held.refreshToken);
      if (refreshed.kind === 'ok') return adopt(refreshed.session, false);

      if (refreshed.reason === 'network') {
        // The token may still be good for a moment; keep the session and come back to it rather
        // than throwing away goals because the wifi dropped.
        if (held.expiresAt > secondsNow()) {
          cancelTimer();
          timer = setTimer(() => {
            void getToken();
          }, REFRESH_RETRY_MS);
          return held.accessToken;
        }
        return giveUp('network');
      }

      // Refused. Before believing that this account is gone, ask whether a sibling tab has
      // already turned the same session into a working one.
      const stored = store.read();
      if (stored !== null && stored.refreshToken !== held.refreshToken) {
        held = stored;
        continue;
      }

      // Nothing anywhere but the token we just spent. Whatever it reached is unreachable now, so
      // stop offering it — carefully, in case a sibling wrote in the meantime.
      discard(held);
      held = null;
    }

    if (held !== null) {
      // A sibling keeps producing sessions and Supabase keeps refusing them. Something upstream
      // is wrong, and minting a new account over the top of a session that may well still be
      // good would cost somebody their goals to find out. Say so; the retry button re-reads.
      return giveUp('upstream');
    }

    const created = await transport.signInAnonymously();
    if (created.kind === 'ok') {
      // A new account, so anything remembered about the old one is not about this one.
      return adopt(created.session, true);
    }
    return giveUp(created.reason);
  }

  function getToken(): Promise<string | null> {
    inFlight ??= resolve().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  /**
   * A sibling tab wrote a session. Take it, if it is better than what this tab is holding.
   *
   * This is the cheap half of the two-tab problem: a tab that has been sitting in the background
   * for an hour wakes up with a token its sibling has already rotated, and the refresh it is about
   * to attempt is doomed. Hearing the write means it never makes that call.
   *
   * Three things it deliberately does not do. It does not interrupt an attempt already running —
   * that attempt re-reads the store itself when it is refused. It does not sign this tab out
   * because a sibling cleared storage; a session that still works here is still worth having. And
   * it does not write anything back, so tabs cannot bounce a value between each other.
   */
  function onSiblingWrite(): void {
    if (inFlight !== null) return;

    const incoming = store.read();
    if (incoming === null || incoming.expiresAt <= secondsNow()) return;
    if (session !== null && incoming.expiresAt <= session.expiresAt) return;

    hold(incoming, false);
  }

  let unwatch: (() => void) | null = null;

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (started) return;
      started = true;
      // Subscribed here rather than at construction, so building a store is free of side effects
      // and a store that is never started leaves no listener behind.
      unwatch = store.subscribe?.(onSiblingWrite) ?? null;
      void getToken();
    },
    retry() {
      if (state.status === 'unavailable') publish({ status: 'signing-in' });
      void getToken();
    },
    getToken,
    stop() {
      cancelTimer();
      unwatch?.();
      unwatch = null;
      started = false;
      listeners.clear();
    },
  };
}
