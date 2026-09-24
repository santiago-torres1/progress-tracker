/*
 * Mounting a screen the way the app mounts it: behind the session gate, with a token.
 *
 * The gate is real in these tests rather than stubbed. That is the point — "does a request carry
 * an Authorization header" is the single thing that decides whether the deployed app works at all,
 * so it is asserted on the way through rather than assumed.
 *
 * What is faked is the identity provider, because a test should not talk to Supabase.
 */

import { MemoryRouter } from 'react-router-dom';
import { render, screen, type RenderResult } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import type { ReactNode } from 'react';
import { SessionGate } from '../components/SessionGate';
import type { AuthAttempt, AuthSession, AuthTransport, SessionStore } from '../lib/supabaseAuth';
import { createAuthStore, type AuthStore } from '../lib/auth';

export const TEST_TOKEN = 'test-access-token';

export const TEST_ZONE = 'Europe/Madrid';

function session(accessToken = TEST_TOKEN): AuthSession {
  return {
    accessToken,
    refreshToken: 'test-refresh-token',
    // An hour ahead of the fake clock below, so nothing tries to refresh mid-test.
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

/** A transport that signs in immediately, and counts how many accounts it was asked for. */
export function workingTransport(): AuthTransport & { signIns: Mock<() => Promise<AuthAttempt>> } {
  const signIns = vi.fn<() => Promise<AuthAttempt>>(() =>
    Promise.resolve({ kind: 'ok', session: session() }),
  );
  return {
    signInAnonymously: signIns,
    refresh: () => Promise.resolve({ kind: 'ok', session: session() }),
    signIns,
  };
}

/** A transport that cannot sign anyone in. `reason` decides which sentence the gate shows. */
export function failingTransport(
  reason: Exclude<AuthAttempt, { kind: 'ok' }>['reason'],
): AuthTransport {
  return {
    signInAnonymously: () => Promise.resolve({ kind: 'failed', reason }),
    refresh: () => Promise.resolve({ kind: 'failed', reason }),
  };
}

/** A session store backed by a plain object, so one test cannot leak into the next. */
export function freshStore(initial: AuthSession | null = null): SessionStore {
  let held = initial;
  return {
    read: () => held,
    write: (next) => {
      held = next;
    },
    clear: () => {
      held = null;
    },
  };
}

export function testAuthStore(
  transport: AuthTransport,
  store: SessionStore = freshStore(),
): AuthStore {
  return createAuthStore({
    transport,
    store,
    // No real timers: a refresh scheduled an hour out must not keep a test process alive.
    setTimer: () => 0,
    clearTimer: () => undefined,
  });
}

export interface HarnessOptions {
  transport?: AuthTransport;
  store?: SessionStore;
  timeZone?: string;
  /** The URL to start at, for a screen that reads one. Defaults to the board. */
  at?: string;
}

/** Renders `children` behind a working session gate, with the browser zone pinned. */
export function renderSignedIn(children: ReactNode, options: HarnessOptions = {}): RenderResult {
  const authStore = testAuthStore(options.transport ?? workingTransport(), options.store);
  return render(
    // A router, because the screens are inside one in the app: the calendar navigates to a goal,
    // and the board reads which goal it was asked for. A screen rendered without one throws.
    <MemoryRouter initialEntries={[options.at ?? '/']}>
      <SessionGate store={authStore} browserTimeZone={options.timeZone ?? TEST_ZONE}>
        {children}
      </SessionGate>
    </MemoryRouter>,
  );
}

/** Waits for the gate to let the app through, so a test starts from the screen it means to test. */
export async function waitForBoard(): Promise<void> {
  await screen.findByLabelText('Your goals');
}

/** Clears anything the gate remembers between visits, so each test is genuinely a first run. */
export function forgetBrowserMemory(): void {
  try {
    globalThis.localStorage.clear();
  } catch {
    // No storage in this environment; nothing to forget.
  }
}
