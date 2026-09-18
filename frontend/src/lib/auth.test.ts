/*
 * The sign-in state machine.
 *
 * Read this as a list of the ways somebody could lose access to goals they already made, each one
 * pinned down so it cannot happen quietly:
 *
 * - a returning visitor having a second account minted over the top of their first;
 * - a dropped connection during a routine refresh throwing away a session that was still valid;
 * - two tiles tapped at once producing two accounts;
 * - a spent refresh token leaving the app stuck instead of starting again;
 * - two open tabs refreshing at once, where Supabase rotates the token out from under the slower
 *   one and it mistakes "my sibling got there first" for "this account is gone".
 */

import { describe, expect, it, vi } from 'vitest';
import { createAuthStore } from './auth';
import type { AuthAttempt, AuthSession, AuthTransport, SessionStore } from './supabaseAuth';

const NOW_MS = 1_700_000_000_000;
const NOW_SECONDS = NOW_MS / 1000;

function session(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: NOW_SECONDS + 3600,
    ...overrides,
  };
}

function store(initial: AuthSession | null = null): SessionStore & { held: AuthSession | null } {
  const held = {
    held: initial,
    read: () => held.held,
    write: (next: AuthSession) => {
      held.held = next;
    },
    clear: () => {
      held.held = null;
    },
  };
  return held;
}

/** A store two tabs share, which tells its subscribers when it is written — i.e. `localStorage`. */
function watchedStore(
  initial: AuthSession | null = null,
): SessionStore & { held: AuthSession | null } {
  const listeners = new Set<() => void>();
  const shared = {
    held: initial,
    read: () => shared.held,
    write: (next: AuthSession) => {
      shared.held = next;
      for (const listener of listeners) listener();
    },
    clear: () => {
      shared.held = null;
      for (const listener of listeners) listener();
    },
    subscribe: (onChange: () => void) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
  return shared;
}

interface Stubbed extends AuthTransport {
  signIns: number;
  refreshes: number;
}

function transport(
  onSignIn: () => AuthAttempt,
  onRefresh: () => AuthAttempt = () => ({ kind: 'ok', session: session() }),
): Stubbed {
  const stub: Stubbed = {
    signIns: 0,
    refreshes: 0,
    signInAnonymously: () => {
      stub.signIns += 1;
      return Promise.resolve(onSignIn());
    },
    refresh: () => {
      stub.refreshes += 1;
      return Promise.resolve(onRefresh());
    },
  };
  return stub;
}

function build(
  sessionStore: SessionStore,
  auth: AuthTransport,
  clock: () => number = () => NOW_MS,
) {
  return createAuthStore({
    transport: auth,
    store: sessionStore,
    now: clock,
    // No real timers: a refresh scheduled an hour out must not keep the process alive.
    setTimer: () => 0,
    clearTimer: () => undefined,
  });
}

describe('createAuthStore — a first visit', () => {
  it('starts out signing in, and says so', () => {
    const auth = build(
      store(),
      transport(() => ({ kind: 'ok', session: session() })),
    );

    expect(auth.getState()).toEqual({ status: 'signing-in' });
  });

  it('mints an anonymous account and remembers it', async () => {
    const held = store();
    const stub = transport(() => ({ kind: 'ok', session: session() }));
    const auth = build(held, stub);

    expect(await auth.getToken()).toBe('access-1');
    expect(auth.getState()).toEqual({
      status: 'signed-in',
      accessToken: 'access-1',
      fresh: true,
    });
    expect(held.held).toEqual(session());
    expect(stub.signIns).toBe(1);
  });

  it('gives up calmly when the build has no Supabase project', async () => {
    const auth = createAuthStore({ transport: null, store: store(), now: () => NOW_MS });

    expect(await auth.getToken()).toBeNull();
    expect(auth.getState()).toEqual({ status: 'unavailable', reason: 'not_configured' });
  });

  it('reports each way sign-in can fail with its own reason', async () => {
    for (const reason of ['disabled', 'rate_limited', 'network', 'upstream'] as const) {
      const auth = build(
        store(),
        transport(() => ({ kind: 'failed', reason })),
      );

      expect(await auth.getToken()).toBeNull();
      expect(auth.getState()).toEqual({ status: 'unavailable', reason });
    }
  });

  it('shares one attempt between callers, so two taps cannot make two accounts', async () => {
    const stub = transport(() => ({ kind: 'ok', session: session() }));
    const auth = build(store(), stub);

    const [first, second, third] = await Promise.all([
      auth.getToken(),
      auth.getToken(),
      auth.getToken(),
    ]);

    expect([first, second, third]).toEqual(['access-1', 'access-1', 'access-1']);
    expect(stub.signIns).toBe(1);
  });

  it('only starts once, however many times start() is called', async () => {
    const stub = transport(() => ({ kind: 'ok', session: session() }));
    const auth = build(store(), stub);

    auth.start();
    auth.start();
    await auth.getToken();

    expect(stub.signIns).toBe(1);
  });
});

describe('createAuthStore — coming back', () => {
  it('uses the stored session rather than minting a second account', async () => {
    const stub = transport(() => ({ kind: 'ok', session: session({ accessToken: 'new' }) }));
    const auth = build(store(session()), stub);

    expect(await auth.getToken()).toBe('access-1');
    expect(auth.getState()).toMatchObject({ status: 'signed-in', fresh: false });
    expect(stub.signIns).toBe(0);
    expect(stub.refreshes).toBe(0);
  });

  it('refreshes a token that is about to lapse, before anything uses it', async () => {
    // Inside the one-minute margin: still technically valid, and refreshed anyway.
    const nearly = session({ expiresAt: NOW_SECONDS + 30 });
    const held = store(nearly);
    const stub = transport(
      () => ({ kind: 'failed', reason: 'upstream' }),
      () => ({ kind: 'ok', session: session({ accessToken: 'access-2' }) }),
    );
    const auth = build(held, stub);

    expect(await auth.getToken()).toBe('access-2');
    expect(stub.refreshes).toBe(1);
    expect(stub.signIns).toBe(0);
    expect(held.held?.accessToken).toBe('access-2');
  });

  it('starts a new account when the refresh token has been spent', async () => {
    const held = store(session({ expiresAt: NOW_SECONDS - 10 }));
    const stub = transport(
      () => ({ kind: 'ok', session: session({ accessToken: 'access-3' }) }),
      () => ({ kind: 'failed', reason: 'upstream' }),
    );
    const auth = build(held, stub);

    expect(await auth.getToken()).toBe('access-3');
    expect(stub.refreshes).toBe(1);
    expect(stub.signIns).toBe(1);
    expect(auth.getState()).toMatchObject({ status: 'signed-in', fresh: true });
  });
});

/*
 * Two tabs, one account.
 *
 * Supabase rotates refresh tokens: a successful refresh spends the token it was given, and the old
 * one stops working almost immediately. So the second of two open tabs to refresh is refused —
 * through no fault of its own, holding a session that has simply been superseded. Reading that as
 * "the account is gone" and minting a new anonymous one is the worst bug this app can have: the
 * goals still exist, and nothing can ever reach them again.
 */
describe('createAuthStore — two tabs, and Supabase rotating refresh tokens', () => {
  /** What tab A's refresh turns S into. Longer-lived, because it was issued later. */
  const rotated = session({
    accessToken: 'access-2',
    refreshToken: 'refresh-2',
    expiresAt: NOW_SECONDS + 7200,
  });

  it('adopts the session the other tab refreshed into, rather than minting a second account', async () => {
    let clockMs = NOW_MS;
    const clock = () => clockMs;
    // One `localStorage`, shared, holding S. Deliberately without `subscribe`: the fix has to hold
    // in a browser that never delivers a storage event.
    const shared = store(session());

    const tabA = build(
      shared,
      transport(
        () => ({ kind: 'failed', reason: 'upstream' }),
        () => ({ kind: 'ok', session: rotated }),
      ),
      clock,
    );

    let signIns = 0;
    let refreshes = 0;
    const tabB = createAuthStore({
      store: shared,
      now: clock,
      setTimer: () => 0,
      clearTimer: () => undefined,
      transport: {
        signInAnonymously: () => {
          signIns += 1;
          return Promise.resolve({
            kind: 'ok',
            session: session({ accessToken: 'a-new-account' }),
          });
        },
        refresh: async () => {
          refreshes += 1;
          // Tab A's timer fires while this request is in flight. Its refresh lands first, spends
          // S and leaves S′ in storage — which is what makes the answer to this one a refusal.
          await tabA.getToken();
          return { kind: 'failed', reason: 'upstream' };
        },
      },
    });

    // Both tabs open, both holding S.
    expect(await tabA.getToken()).toBe('access-1');
    expect(await tabB.getToken()).toBe('access-1');

    // Nearly an hour later: both refresh timers are due.
    clockMs = NOW_MS + 3_540_000;
    const token = await tabB.getToken();

    expect(refreshes).toBe(1);
    expect(token).toBe('access-2');
    expect(tabB.getState()).toEqual({
      status: 'signed-in',
      accessToken: 'access-2',
      fresh: false,
    });
    // The two things that would mean orphaned goals: a new account, or S′ wiped out of storage.
    expect(signIns).toBe(0);
    expect(shared.held).toEqual(rotated);
  });

  it('leaves a sibling’s newer session in storage when its own token is refused', async () => {
    const shared = store(session({ expiresAt: NOW_SECONDS - 10 }));
    const stub = transport(
      () => ({ kind: 'ok', session: session({ accessToken: 'a-new-account' }) }),
      () => {
        // While this refresh was in flight, the other tab wrote the session it got back.
        shared.write(rotated);
        return { kind: 'failed', reason: 'upstream' };
      },
    );

    expect(await build(shared, stub).getToken()).toBe('access-2');
    expect(stub.signIns).toBe(0);
    expect(shared.held).toEqual(rotated);
  });

  it('takes a sibling’s session from the storage event, without refreshing anything', async () => {
    const shared = watchedStore(session());
    const stub = transport(
      () => ({ kind: 'failed', reason: 'upstream' }),
      () => ({ kind: 'failed', reason: 'upstream' }),
    );
    const tab = build(shared, stub);

    tab.start();
    expect(await tab.getToken()).toBe('access-1');

    // The other tab refreshes and writes the result. This one hears it and stops holding a token
    // that has just been spent — so the refresh it would have attempted never happens.
    shared.write(rotated);

    expect(tab.getState()).toEqual({ status: 'signed-in', accessToken: 'access-2', fresh: false });
    expect(stub.refreshes).toBe(0);
    expect(stub.signIns).toBe(0);
    tab.stop();
  });

  it('keeps working when a sibling clears storage', async () => {
    const shared = watchedStore(session());
    const stub = transport(() => ({ kind: 'failed', reason: 'upstream' }));
    const tab = build(shared, stub);

    tab.start();
    await tab.getToken();
    shared.clear();

    // Another tab giving up, or starting again, is not a reason to drop a session that works here.
    expect(tab.getState()).toMatchObject({ status: 'signed-in', accessToken: 'access-1' });
    tab.stop();
  });

  it('stops after three refusals rather than minting over a session it cannot explain', async () => {
    let generation = 0;
    const shared = store(session({ expiresAt: NOW_SECONDS - 10 }));
    const stub = transport(
      () => ({ kind: 'ok', session: session({ accessToken: 'a-new-account' }) }),
      () => {
        // Something upstream is refusing everything, and a sibling keeps writing new sessions.
        generation += 1;
        shared.write(
          session({
            accessToken: `sibling-access-${generation}`,
            refreshToken: `sibling-refresh-${generation}`,
            expiresAt: NOW_SECONDS - 10,
          }),
        );
        return { kind: 'failed', reason: 'upstream' };
      },
    );
    const auth = build(shared, stub);

    expect(await auth.getToken()).toBeNull();
    expect(auth.getState()).toEqual({ status: 'unavailable', reason: 'upstream' });
    expect(stub.refreshes).toBe(3);
    // Saying "not now" is recoverable. Minting an account over the top of somebody's goals is not.
    expect(stub.signIns).toBe(0);
    expect(shared.held).not.toBeNull();
  });

  it('refreshes from the sibling’s session when that one has lapsed as well', async () => {
    let refused = true;
    const shared = store(session({ expiresAt: NOW_SECONDS - 10 }));
    const stub = transport(
      () => ({ kind: 'ok', session: session({ accessToken: 'a-new-account' }) }),
      () => {
        if (!refused) return { kind: 'ok', session: rotated };
        refused = false;
        shared.write(session({ refreshToken: 'refresh-sibling', expiresAt: NOW_SECONDS - 10 }));
        return { kind: 'failed', reason: 'upstream' };
      },
    );
    const auth = build(shared, stub);

    expect(await auth.getToken()).toBe('access-2');
    expect(stub.signIns).toBe(0);
  });
});

describe('createAuthStore — a refresh that fails mid-session', () => {
  it('keeps a token that has not lapsed yet when the connection drops', async () => {
    // The dangerous case: a dropped wifi during a routine refresh must not cost somebody their
    // board when the token in hand is still good for another half minute.
    const held = store(session({ expiresAt: NOW_SECONDS + 30 }));
    const stub = transport(
      () => ({ kind: 'ok', session: session({ accessToken: 'brand-new' }) }),
      () => ({ kind: 'failed', reason: 'network' }),
    );
    const auth = build(held, stub);

    expect(await auth.getToken()).toBe('access-1');
    expect(stub.signIns).toBe(0);
    expect(held.held?.refreshToken).toBe('refresh-1');
  });

  it('says it is unavailable once the token really has lapsed', async () => {
    const auth = build(
      store(session({ expiresAt: NOW_SECONDS - 10 })),
      transport(
        () => ({ kind: 'ok', session: session() }),
        () => ({ kind: 'failed', reason: 'network' }),
      ),
    );

    expect(await auth.getToken()).toBeNull();
    expect(auth.getState()).toEqual({ status: 'unavailable', reason: 'network' });
  });

  it('schedules the swap a minute before the token lapses', async () => {
    const setTimer = vi.fn<(run: () => void, ms: number) => ReturnType<typeof setTimeout>>(() => 0);
    const auth = createAuthStore({
      transport: transport(() => ({ kind: 'ok', session: session() })),
      store: store(),
      now: () => NOW_MS,
      setTimer,
      clearTimer: () => undefined,
    });

    await auth.getToken();

    // 3600s of life, less the 60s margin.
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 3_540_000);
  });
});

describe('createAuthStore — telling the app about it', () => {
  it('notifies subscribers when the state moves, and stops when they leave', async () => {
    const auth = build(
      store(),
      transport(() => ({ kind: 'ok', session: session() })),
    );
    const seen: string[] = [];
    const unsubscribe = auth.subscribe(() => seen.push(auth.getState().status));

    await auth.getToken();
    expect(seen).toEqual(['signed-in']);

    unsubscribe();
    auth.retry();
    await auth.getToken();
    expect(seen).toEqual(['signed-in']);
  });

  it('goes back to signing-in when a person asks for another go', async () => {
    let attempt = 0;
    const auth = build(
      store(),
      transport(() => {
        attempt += 1;
        return attempt === 1
          ? { kind: 'failed', reason: 'network' }
          : { kind: 'ok', session: session() };
      }),
    );

    expect(await auth.getToken()).toBeNull();
    expect(auth.getState()).toMatchObject({ status: 'unavailable' });

    const states: string[] = [];
    auth.subscribe(() => states.push(auth.getState().status));
    auth.retry();
    expect(await auth.getToken()).toBe('access-1');

    expect(states).toEqual(['signing-in', 'signed-in']);
  });
});
