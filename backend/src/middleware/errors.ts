import { STATUS_CODES } from 'node:http';

import type { ErrorRequestHandler, RequestHandler } from 'express';

/** "Payload Too Large" -> "payload_too_large". */
function errorCode(status: number): string {
  return (STATUS_CODES[status] ?? 'error').toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

/** Status of an http-errors style client error (e.g. malformed JSON from express.json()). */
function clientErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = 'status' in error ? error.status : undefined;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: errorCode(404) });
};

/**
 * Final error handler. Responses carry only a short code: never a message, stack trace, or
 * upstream detail. Unexpected errors are logged server-side (CloudWatch on Lambda).
 */
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    // Too late to send a JSON body; let Express close the connection.
    next(error);
    return;
  }

  const clientStatus = clientErrorStatus(error);
  if (clientStatus !== undefined) {
    res.status(clientStatus).json({ error: errorCode(clientStatus) });
    return;
  }

  console.error(`[error] unhandled error on ${req.method} ${req.path}`, error);
  res.status(500).json({ error: errorCode(500) });
};
