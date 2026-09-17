/*
 * The app's clock, in one place.
 *
 * The design components have none: "today", the now-line and "still to come" are all decided
 * here and passed down as plain values. One ticking clock at the root keeps them agreed with
 * each other — two components calling `new Date()` a millisecond apart could disagree about
 * which day it is, once a year, at midnight.
 */

import { useEffect, useState } from 'react';

const ONE_MINUTE_MS = 60_000;

/** A Date that refreshes on an interval, so the now-line and today never go stale on screen. */
export function useNow(intervalMs: number = ONE_MINUTE_MS): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, intervalMs);

    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);

  return now;
}
