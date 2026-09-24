import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { ProfileScreen } from './ProfileScreen';
import {
  SessionContextProvider,
  type AppSession,
  type AuthorizedCall,
} from '../lib/sessionContext';
import { weekStartLabel } from '../lib/profile';
import { jsonResponse, sessionPayload, stubFetch, type SeenRequest } from '../test/fixtures';
import { TEST_TOKEN, forgetBrowserMemory, renderSignedIn } from '../test/harness';
import type { SessionProfile } from '../types/api';

/*
 * The profile page: the facts, the two settings, and the three states the read can be in.
 *
 * Two ways of mounting it, on purpose. `renderSignedIn` puts the real gate and a real token behind
 * it, which is how the app runs it and the only way to assert that its requests carry an
 * Authorization header. `withSession` supplies the session context directly, which is the only way
 * to hold a read open, fail one, or watch what the page hands back to the rest of the app.
 */

/** A page mounted on a session whose every call is under the test's control. */
function withSession(node: ReactNode, call: AuthorizedCall, overrides: Partial<AppSession> = {}) {
  const value: AppSession = {
    call,
    profile: sessionPayload().session,
    reloadProfile: () => undefined,
    applyProfile: () => undefined,
    ...overrides,
  };
  return render(<SessionContextProvider value={value}>{node}</SessionContextProvider>);
}

/** A call that runs the real client against whatever `stubFetch` is answering. */
const realCall: AuthorizedCall = (run, signal) => run({ accessToken: TEST_TOKEN, signal });

/**
 * The value of one settings row, read from the row itself.
 *
 * Not `getByText`: a zone name is also the text of an `<option>` inside the open picker, and a
 * query that matched one of those would pass while the row said something else entirely.
 */
function rowValue(label: string): string {
  const row = screen.getByText(label, { selector: 'dt' }).closest('.rows__row');
  return row?.querySelector('dd')?.textContent ?? '';
}

/** The text of the count whose label this is — "7 glasses filled" as one string. */
function count(label: string): string {
  const row = screen.getByText(label).closest('li');
  return row?.textContent ?? '';
}

function sessionWrites(writes: SeenRequest[]): SeenRequest[] {
  return writes.filter((request) => request.path === '/api/session');
}

/** Whether a request body is the week-start patch, without asserting anything about its shape. */
function isWeekStart(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'weekStartsOn' in body;
}

describe('ProfileScreen', () => {
  beforeEach(() => {
    forgetBrowserMemory();
  });

  describe('while the read is happening, and when it does not arrive', () => {
    it('says it is reading, rather than showing an account with no numbers in it', () => {
      withSession(<ProfileScreen />, () => new Promise<never>(() => undefined));

      expect(screen.getByRole('status')).toHaveTextContent('Reading your profile…');
      expect(screen.queryByText('glasses filled')).not.toBeInTheDocument();
    });

    it('says the connection is the likely problem, and offers another go', async () => {
      let attempts = 0;
      const call: AuthorizedCall = () => {
        attempts += 1;
        return Promise.resolve({ kind: 'failed', reason: 'network', status: null });
      };
      withSession(<ProfileScreen />, call);

      expect(await screen.findByText('Cannot reach the server from here.')).toBeInTheDocument();
      expect(screen.getByText(/rather than anything you did/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await waitFor(() => {
        expect(attempts).toBe(2);
      });
    });
  });

  describe('once it is there', () => {
    it('states the counts the API holds, and nothing that scores them', async () => {
      stubFetch();
      renderSignedIn(<ProfileScreen />);

      expect(await screen.findByText('glasses filled')).toBeInTheDocument();
      expect(count('glasses filled')).toContain('7');
      expect(count('goals on the board')).toContain('5');
      expect(count('things ticked off')).toContain('128');
      expect(count('check-ins recorded')).toContain('19');

      const page = screen.getByRole('region', { name: 'Profile' });
      expect(page.textContent).not.toMatch(/trophy|badge|streak|level|score|rank|award|best/i);
    });

    it('says when the account appeared, in its own zone, and how long ago that was', async () => {
      stubFetch();
      renderSignedIn(<ProfileScreen />);

      // The fixture: created 2026-08-14T08:12Z, 34 whole days ago in Europe/Madrid.
      expect(await screen.findByText(/34 days ago/)).toBeInTheDocument();
      expect(screen.getByText('Anonymous account')).toBeInTheDocument();
    });

    it('says what the session costs, without suggesting a way out of it', async () => {
      stubFetch();
      renderSignedIn(<ProfileScreen />);

      expect(await screen.findByText(/Ends 90 days after your last visit/)).toBeInTheDocument();
      expect(screen.getByText(/90 days from your last visit/)).toBeInTheDocument();

      const page = screen.getByRole('region', { name: 'Profile' });
      expect(page.textContent).not.toMatch(/sign up|create an account|log in|password|export/i);
    });

    it('shows the zone and the week start as they stand', async () => {
      stubFetch();
      renderSignedIn(<ProfileScreen />);

      await screen.findByText('glasses filled');
      expect(rowValue('Time zone')).toContain('Europe/Madrid');
      expect(rowValue('Week starts on')).toBe(weekStartLabel(1));
    });
  });

  describe('changing a setting', () => {
    it('sends the week start with a token, and says what changed', async () => {
      let held = sessionPayload().session;
      const stub = stubFetch({
        session: (method, body) => {
          if (method === 'PATCH' && isWeekStart(body)) held = { ...held, weekStartsOn: 7 };
          return jsonResponse({ session: held });
        },
      });
      renderSignedIn(<ProfileScreen />);

      fireEvent.click(await screen.findByRole('button', { name: 'Change week start' }));

      const field = screen.getByLabelText('Week starts on');
      expect(document.activeElement).toBe(field);

      fireEvent.change(field, { target: { value: '7' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(
        await screen.findByText(`Saved. Your weeks start on ${weekStartLabel(7)} from now on.`),
      ).toBeInTheDocument();

      // The picker closes, and the row now reads the day that was chosen.
      expect(screen.queryByLabelText('Week starts on')).not.toBeInTheDocument();
      expect(rowValue('Week starts on')).toBe(weekStartLabel(7));

      const writes = sessionWrites(stub.writes());
      const last = writes[writes.length - 1];
      expect(last?.method).toBe('PATCH');
      expect(last?.body).toEqual({ weekStartsOn: 7 });
      expect(last?.authorization).toBe(`Bearer ${TEST_TOKEN}`);
    });

    it('sends the chosen zone, and hands the recomputed profile to the rest of the app', async () => {
      const moved: SessionProfile = { ...sessionPayload().session, timeZone: 'Pacific/Auckland' };
      const stub = stubFetch({
        session: (method) =>
          method === 'PATCH' ? jsonResponse({ session: moved }) : jsonResponse(sessionPayload()),
      });

      const applied: SessionProfile[] = [];
      withSession(<ProfileScreen />, realCall, {
        applyProfile: (profile) => {
          applied.push(profile);
        },
      });

      fireEvent.click(await screen.findByRole('button', { name: 'Change time zone' }));
      fireEvent.change(screen.getByLabelText('Time zone'), {
        target: { value: 'Pacific/Auckland' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(rowValue('Time zone')).toContain('Pacific/Auckland');
      });

      // The zone decides which day a tick lands on, so the whole app is told — from the response,
      // not from a second read.
      await waitFor(() => {
        expect(applied).toEqual([moved]);
      });
      expect(sessionWrites(stub.writes())[0]?.body).toEqual({ timeZone: 'Pacific/Auckland' });
    });

    it('keeps the picker open and blames the server when a save cannot be sent', async () => {
      stubFetch({
        session: (method) =>
          method === 'PATCH'
            ? jsonResponse({ error: 'unavailable', reason: 'upstream_error' }, 503)
            : jsonResponse(sessionPayload()),
      });
      withSession(<ProfileScreen />, realCall);

      fireEvent.click(await screen.findByRole('button', { name: 'Change week start' }));
      fireEvent.change(screen.getByLabelText('Week starts on'), { target: { value: '7' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('Nothing to show just now.')).toBeInTheDocument();
      // Still open, still on the value that was chosen: nothing to type again.
      expect(screen.getByLabelText('Week starts on')).toHaveValue('7');
      expect(rowValue('Week starts on')).toBe(weekStartLabel(1));
    });

    it('closes the picker on Cancel without sending anything', async () => {
      const stub = stubFetch();
      withSession(<ProfileScreen />, realCall);

      fireEvent.click(await screen.findByRole('button', { name: 'Change time zone' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByLabelText('Time zone')).not.toBeInTheDocument();
      expect(sessionWrites(stub.writes())).toHaveLength(0);
    });

    it('offers the zone in use and this browser’s own, whatever the browser can list', async () => {
      stubFetch();
      withSession(<ProfileScreen />, realCall);

      fireEvent.click(await screen.findByRole('button', { name: 'Change time zone' }));

      const field = screen.getByLabelText('Time zone');
      expect(field).toHaveValue('Europe/Madrid');
      expect(screen.getByRole('option', { name: 'UTC' })).toBeInTheDocument();
    });
  });
});
