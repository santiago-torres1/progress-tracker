/*
 * The session every screen reads: a way to make an authenticated call, and the profile behind it.
 *
 * `call` rather than a bare token on purpose. A token lapses after an hour, and a screen that
 * captured one at mount would keep sending a dead string until something forced it to re-render.
 * `call` asks the auth store for a token at the moment of the request, so a refresh is invisible
 * to every caller and the function identity never changes — which matters, because these go
 * straight into `useCallback` dependency lists that decide when a read runs again.
 */

import { createContext, useContext } from 'react';
import type { ApiRequestOptions, ApiResult } from './api';
import type { SessionProfile } from '../types/api';

/** Runs one API call with a valid token. Never throws for an expected failure. */
export type AuthorizedCall = <T>(
  run: (options: ApiRequestOptions) => Promise<ApiResult<T>>,
  signal?: AbortSignal,
) => Promise<ApiResult<T>>;

export interface AppSession {
  call: AuthorizedCall;
  /** The profile as the server holds it: the zone days are measured in, and where a week starts. */
  profile: SessionProfile;
  /** Re-reads the profile. The way back from a failed read, not the way to apply a change. */
  reloadProfile: () => void;
  /**
   * Replaces the held profile with one a write just answered with.
   *
   * `PATCH /api/session` returns the recomputed profile, so a screen that changed the time zone
   * already has the truth in its hand: handing it over is both cheaper and more correct than asking
   * again, and it is the same principle as a tile refilling from its own write's response. It must
   * be a profile the server returned — never one assembled in the browser from a form.
   */
  applyProfile: (profile: SessionProfile) => void;
}

const SessionContext = createContext<AppSession | null>(null);

export const SessionContextProvider = SessionContext.Provider;

/**
 * The session, from inside the gate that guarantees there is one.
 *
 * Throws rather than returning null: every screen below the gate has a session by construction, so
 * a null here is a component mounted in the wrong place — a bug to fix, not a state to render.
 */
export function useAppSession(): AppSession {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error('useAppSession must be used inside a SessionGate');
  }
  return session;
}
