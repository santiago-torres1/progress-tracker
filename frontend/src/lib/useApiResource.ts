/*
 * One read, held in state.
 *
 * Deliberately not a cache and not a retry loop: v0.1.1-alpha reads three endpoints once each,
 * the responses carry `Cache-Control: public, max-age=60`, and a page that retries on its own
 * turns a quiet outage into a noisy one. `reload` exists so a person can ask again, once.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ApiResult } from './api';

/** A read that has not finished yet, or its result. */
export type Loadable<T> = { kind: 'loading' } | ApiResult<T>;

export interface Resource<T> {
  state: Loadable<T>;
  reload: () => void;
}

type Loader<T> = (signal: AbortSignal) => Promise<ApiResult<T>>;

/** A result, stamped with the request that produced it. */
interface Answer<T> {
  load: Loader<T>;
  attempt: number;
  result: ApiResult<T>;
}

/**
 * Runs `load` and keeps its result.
 *
 * `load` must be stable — wrap it in `useCallback` keyed on whatever it closes over (a date
 * range, say), because that identity is exactly what decides when a new request goes out.
 *
 * "Loading" is derived rather than stored: it is simply "the answer on hand is not the answer to
 * the question now being asked". That keeps the effect free of a synchronous setState, and means
 * a stale answer can never be shown for a render after the question changed.
 */
export function useApiResource<T>(load: Loader<T>): Resource<T> {
  const [answer, setAnswer] = useState<Answer<T> | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    load(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setAnswer({ load, attempt, result });
      })
      .catch(() => {
        // Only reachable when this effect was cleaned up mid-flight; nothing to render.
      });

    return () => {
      controller.abort();
    };
  }, [load, attempt]);

  const reload = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);

  const state: Loadable<T> =
    answer !== null && answer.load === load && answer.attempt === attempt
      ? answer.result
      : { kind: 'loading' };

  return { state, reload };
}
