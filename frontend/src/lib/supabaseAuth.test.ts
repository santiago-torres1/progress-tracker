/*
 * The Supabase Auth transport, on its own.
 *
 * This is the file that replaces `@supabase/supabase-js` for our three needs, so it is tested as
 * if it were a dependency: the exact endpoints, the exact headers, and every answer GoTrue gives
 * that we have to tell apart. A mistake here does not degrade the app — it locks somebody out of
 * goals they already made.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  httpTransport,
  localSessionStore,
  memorySessionStore,
  parseTokenPayload,
  readSupabaseConfig,
} from './supabaseAuth';

const CONFIG = { url: 'https://project.supabase.co', anonKey: 'anon-key' };

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const TOKENS = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  expires_at: 1_800_000_000,
};

describe('readSupabaseConfig', () => {
  it('reads the two build-time variables', () => {
    const config = readSupabaseConfig({
      VITE_SUPABASE_URL: 'https://project.supabase.co/',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    });

    // The trailing slash is trimmed, so paths are joined exactly once.
    expect(config).toEqual({ url: 'https://project.supabase.co', anonKey: 'anon-key' });
  });

  it('is null when a build was made without them, rather than throwing', () => {
    expect(readSupabaseConfig({})).toBeNull();
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://x.co' })).toBeNull();
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: '  ', VITE_SUPABASE_ANON_KEY: 'k' })).toBeNull();
  });
});

describe('parseTokenPayload', () => {
  it('prefers the server’s own expiry over the one it derives', () => {
    const session = parseTokenPayload(TOKENS, 0);

    expect(session).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1_800_000_000,
    });
  });

  it('derives an expiry from expires_in when the server sends no absolute one', () => {
    const session = parseTokenPayload(
      { access_token: 'a', refresh_token: 'r', expires_in: 60 },
      10_000,
    );

    expect(session?.expiresAt).toBe(70);
  });

  it('refuses a payload with no usable tokens in it', () => {
    expect(parseTokenPayload({ access_token: 'a' }, 0)).toBeNull();
    expect(parseTokenPayload({ access_token: '', refresh_token: 'r' }, 0)).toBeNull();
    expect(parseTokenPayload('not an object', 0)).toBeNull();
    expect(parseTokenPayload(null, 0)).toBeNull();
  });
});

describe('httpTransport.signInAnonymously', () => {
  it('posts a credential-less signup with the anon key on it', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(respond(TOKENS));
    const result = await httpTransport(CONFIG, fetchImpl).signInAnonymously();

    expect(result.kind).toBe('ok');
    expect(result.kind === 'ok' ? result.session.accessToken : null).toBe('access-1');

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://project.supabase.co/auth/v1/signup');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.apikey).toBe('anon-key');
    expect(headers.authorization).toBe('Bearer anon-key');
    expect(init?.body).toBe(JSON.stringify({ data: {} }));
  });

  it('tells "anonymous sign-ins are off" apart from everything else', async () => {
    const body = { error_code: 'anonymous_provider_disabled', msg: 'Anonymous sign-ins disabled' };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(respond(body, 422));

    expect(await httpTransport(CONFIG, fetchImpl).signInAnonymously()).toEqual({
      kind: 'failed',
      reason: 'disabled',
    });
  });

  it('recognises the per-IP ceiling on new accounts', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(respond({ msg: 'too many' }, 429));

    expect(await httpTransport(CONFIG, fetchImpl).signInAnonymously()).toEqual({
      kind: 'failed',
      reason: 'rate_limited',
    });
  });

  it('reports a network failure as one, without throwing', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await httpTransport(CONFIG, fetchImpl).signInAnonymously()).toEqual({
      kind: 'failed',
      reason: 'network',
    });
  });

  it('treats a 200 that is not a token payload as an upstream problem', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(respond({ hello: 'world' }));

    expect(await httpTransport(CONFIG, fetchImpl).signInAnonymously()).toEqual({
      kind: 'failed',
      reason: 'upstream',
    });
  });

  it('never puts an upstream message into its result', async () => {
    const body = { error_code: 'unexpected_failure', msg: 'relation "users" does not exist' };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(respond(body, 500));
    const result = await httpTransport(CONFIG, fetchImpl).signInAnonymously();

    expect(JSON.stringify(result)).not.toMatch(/relation|users/);
  });
});

describe('httpTransport.refresh', () => {
  it('swaps a refresh token at the grant endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(respond(TOKENS));
    const result = await httpTransport(CONFIG, fetchImpl).refresh('refresh-0');

    expect(result.kind).toBe('ok');
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://project.supabase.co/auth/v1/token?grant_type=refresh_token');
    expect(init?.body).toBe(JSON.stringify({ refresh_token: 'refresh-0' }));
  });

  it('reports a spent refresh token rather than pretending it worked', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(respond({ error_code: 'refresh_token_not_found' }, 400));

    expect((await httpTransport(CONFIG, fetchImpl).refresh('gone')).kind).toBe('failed');
  });
});

describe('session storage', () => {
  const session = { accessToken: 'a', refreshToken: 'r', expiresAt: 100 };

  it('round-trips a session through a real Storage', () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => backing.set(key, value),
      removeItem: (key: string) => backing.delete(key),
    } as unknown as Storage;

    const store = localSessionStore(storage);
    store.write(session);
    expect(store.read()).toEqual(session);

    store.clear();
    expect(store.read()).toBeNull();
  });

  it('survives a browser that throws on every storage call', () => {
    const hostile = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;

    const store = localSessionStore(hostile);

    // Private-mode Safari throws on setItem. The visitor gets a new account next time, which is a
    // far smaller loss than a white screen.
    expect(() => {
      store.write(session);
    }).not.toThrow();
    expect(store.read()).toBeNull();
    expect(() => {
      store.clear();
    }).not.toThrow();
  });

  it('ignores a stored value that is not a session', () => {
    const backing = new Map<string, string>([['progress-tracker.auth.v1', '{"nope":1}']]);
    const storage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: () => undefined,
      removeItem: () => undefined,
    } as unknown as Storage;

    expect(localSessionStore(storage).read()).toBeNull();
  });

  it('falls back to memory when there is no storage at all', () => {
    const store = memorySessionStore();
    store.write(session);

    expect(store.read()).toEqual(session);
  });

  it('tells a subscriber when another tab writes the session', () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => backing.set(key, value),
      removeItem: (key: string) => backing.delete(key),
    } as unknown as Storage;

    const heard = vi.fn();
    const unsubscribe = localSessionStore(storage).subscribe?.(heard);

    globalThis.dispatchEvent(new StorageEvent('storage', { key: 'progress-tracker.auth.v1' }));
    expect(heard).toHaveBeenCalledTimes(1);

    // Another key in the same origin is somebody else's business.
    globalThis.dispatchEvent(new StorageEvent('storage', { key: 'progress-tracker.time-zone.v1' }));
    expect(heard).toHaveBeenCalledTimes(1);

    // A whole-store clear arrives with no key at all, and takes ours with it.
    globalThis.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(heard).toHaveBeenCalledTimes(2);

    unsubscribe?.();
    globalThis.dispatchEvent(new StorageEvent('storage', { key: 'progress-tracker.auth.v1' }));
    expect(heard).toHaveBeenCalledTimes(2);
  });

  // A memory store is one tab's private variable: there is no sibling to hear from, and it says
  // so by not implementing `subscribe` at all.
  it('offers no cross-tab subscription when there are no other tabs', () => {
    expect('subscribe' in memorySessionStore()).toBe(false);
  });
});
