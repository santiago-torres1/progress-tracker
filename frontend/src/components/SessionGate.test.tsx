/*
 * Signing in, and the three ways it can fail.
 *
 * The release-blocking fact is the first test: a request that leaves this app carries a bearer
 * token. The deployed backend answers 401 to everything without one, so an app that forgets it is
 * not a degraded app, it is a blank one.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SessionGate } from './SessionGate';
import { sessionPayload, stubFetch } from '../test/fixtures';
import {
  TEST_TOKEN,
  TEST_ZONE,
  failingTransport,
  forgetBrowserMemory,
  testAuthStore,
  workingTransport,
} from '../test/harness';

function Inside() {
  return <p>the board</p>;
}

describe('SessionGate', () => {
  beforeEach(() => {
    forgetBrowserMemory();
  });

  it('signs a first-time visitor in without asking them anything', async () => {
    stubFetch();
    const transport = workingTransport();

    render(
      <SessionGate store={testAuthStore(transport)} browserTimeZone={TEST_ZONE}>
        <Inside />
      </SessionGate>,
    );

    expect(await screen.findByText('the board')).toBeInTheDocument();
    expect(transport.signIns).toHaveBeenCalledTimes(1);
    // No sign-in screen, no password field, nothing to fill in.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('puts the access token on every API request', async () => {
    const stub = stubFetch();

    render(
      <SessionGate store={testAuthStore(workingTransport())} browserTimeZone={TEST_ZONE}>
        <Inside />
      </SessionGate>,
    );
    await screen.findByText('the board');

    const apiCalls = stub.seen.filter((request) => request.path.startsWith('/api/'));
    expect(apiCalls.length).toBeGreaterThan(0);
    for (const request of apiCalls) {
      expect(request.authorization).toBe(`Bearer ${TEST_TOKEN}`);
    }
  });

  it('tells the server this browser’s time zone on a first run', async () => {
    const stub = stubFetch();

    render(
      <SessionGate store={testAuthStore(workingTransport())} browserTimeZone="America/New_York">
        <Inside />
      </SessionGate>,
    );
    await screen.findByText('the board');

    const patch = stub.seen.find(
      (request) => request.path === '/api/session' && request.method === 'PATCH',
    );
    expect(patch).toBeDefined();
    expect(patch?.body).toEqual({ timeZone: 'America/New_York' });
  });

  it('does not send the zone again once the server has it', async () => {
    const stub = stubFetch();
    const store = testAuthStore(workingTransport());

    const first = render(
      <SessionGate store={store} browserTimeZone={TEST_ZONE}>
        <Inside />
      </SessionGate>,
    );
    await screen.findByText('the board');
    first.unmount();

    const before = stub.seen.filter((request) => request.method === 'PATCH').length;
    expect(before).toBe(1);

    render(
      <SessionGate store={testAuthStore(workingTransport())} browserTimeZone={TEST_ZONE}>
        <Inside />
      </SessionGate>,
    );
    await screen.findByText('the board');

    expect(stub.seen.filter((request) => request.method === 'PATCH')).toHaveLength(before);
  });

  it('carries on with the profile it has when setting the zone is refused', async () => {
    const stub = stubFetch({
      session: (method) =>
        method === 'PATCH'
          ? new Response(JSON.stringify({ error: 'invalid_request', field: 'timeZone' }), {
              status: 400,
              headers: { 'content-type': 'application/json' },
            })
          : new Response(JSON.stringify(sessionPayload({ timeZone: 'UTC' })), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
    });

    render(
      <SessionGate store={testAuthStore(workingTransport())} browserTimeZone={TEST_ZONE}>
        <Inside />
      </SessionGate>,
    );

    // A zone that would not save is a bug to fix, not a reason to withhold somebody's board.
    expect(await screen.findByText('the board')).toBeInTheDocument();
    expect(
      stub.seen.some((request) => request.path === '/api/session' && request.method === 'GET'),
    ).toBe(true);
  });

  it('says anonymous accounts are switched off, without blaming the visitor', async () => {
    stubFetch();

    render(
      <SessionGate store={testAuthStore(failingTransport('disabled'))} browserTimeZone={TEST_ZONE}>
        <Inside />
      </SessionGate>,
    );

    expect(
      await screen.findByText('New visitors are not being let in just now.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('the board')).not.toBeInTheDocument();
    expect(document.body.textContent).toMatch(/not anything to do with you/i);
    expect(document.body.textContent).not.toMatch(/error|failed|invalid|denied/i);
  });

  it('says the rate limit is about the network, not about them', async () => {
    stubFetch();

    render(
      <SessionGate
        store={testAuthStore(failingTransport('rate_limited'))}
        browserTimeZone={TEST_ZONE}
      >
        <Inside />
      </SessionGate>,
    );

    expect(await screen.findByText('A lot of people have arrived at once.')).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/from this network/i);
  });

  it('says the connection is the likely problem when Supabase cannot be reached', async () => {
    stubFetch();

    render(
      <SessionGate store={testAuthStore(failingTransport('network'))} browserTimeZone={TEST_ZONE}>
        <Inside />
      </SessionGate>,
    );

    expect(
      await screen.findByText('Cannot reach the sign-in service from here.'),
    ).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/rather than anything you did/i);
  });

  it('offers another go, and takes it when pressed', async () => {
    stubFetch();
    let attempts = 0;
    const store = testAuthStore({
      signInAnonymously: () => {
        attempts += 1;
        return Promise.resolve(
          attempts === 1
            ? { kind: 'failed', reason: 'network' }
            : {
                kind: 'ok',
                session: {
                  accessToken: TEST_TOKEN,
                  refreshToken: 'r',
                  expiresAt: Math.floor(Date.now() / 1000) + 3600,
                },
              },
        );
      },
      refresh: () => Promise.resolve({ kind: 'failed', reason: 'network' }),
    });

    render(
      <SessionGate store={store} browserTimeZone={TEST_ZONE}>
        <Inside />
      </SessionGate>,
    );

    const retry = await screen.findByRole('button', { name: 'Try again' });
    retry.click();

    await waitFor(() => {
      expect(screen.getByText('the board')).toBeInTheDocument();
    });
    expect(attempts).toBe(2);
  });

  it('keeps the session it already has rather than minting a second account', async () => {
    stubFetch();
    const transport = workingTransport();
    const held = {
      accessToken: TEST_TOKEN,
      refreshToken: 'r',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    render(
      <SessionGate
        store={testAuthStore(transport, {
          read: () => held,
          write: () => undefined,
          clear: () => undefined,
        })}
        browserTimeZone={TEST_ZONE}
      >
        <Inside />
      </SessionGate>,
    );
    await screen.findByText('the board');

    expect(transport.signIns).not.toHaveBeenCalled();
  });
});
