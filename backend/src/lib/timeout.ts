/** Thrown by withTimeout() when the wrapped promise has not settled in time. */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation exceeded ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Settles with `promise` or rejects after `ms`, whichever comes first.
 *
 * This is the last line of defence, not the only one: callers that can cancel their work (a
 * PostgREST query takes an AbortSignal) should do that too. What this guarantees on its own is
 * that the HTTP response, and so the Lambda invocation, is never held longer than `ms` even if
 * the underlying promise never settles. Promise.race keeps a handler attached to `promise`, so
 * a late rejection is not an unhandled rejection.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
