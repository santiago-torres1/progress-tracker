import express, { type Express } from 'express';

import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { createApiRouter, type ApiRouterOptions } from './routes/api.js';
import { createHealthRouter, type HealthRouterOptions } from './routes/health.js';

export type AppOptions = HealthRouterOptions & ApiRouterOptions;

/**
 * Builds the Express app. Never calls listen(): src/server.ts does that locally, src/lambda.ts
 * wraps the app for Lambda, and tests drive it with supertest.
 */
export function createApp(options: AppOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');

  // No CORS middleware on purpose: CORS is configured once, on the Lambda Function URL
  // (infra/main). Adding it here too would send duplicate Access-Control-* headers.

  // Request bodies are size-limited at the boundary. There are no write routes yet, but the
  // parser is mounted for every request, so the ceiling belongs here rather than in Phase 2:
  // 32 KiB is far more than any goal, note or check-in this app will ever accept, and an
  // oversized body is refused by express.json() before a handler sees it (the error middleware
  // renders it as 413 payload_too_large).
  app.use(express.json({ limit: '32kb' }));

  app.use('/health', createHealthRouter(options));

  // The product API. Mounted after /health so a broken data layer can never take the liveness
  // probe down with it, and so /health stays anonymous while every /api route needs a session.
  app.use('/api', createApiRouter(options));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
