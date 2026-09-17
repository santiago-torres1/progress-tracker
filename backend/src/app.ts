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

  app.use(express.json());

  app.use('/health', createHealthRouter(options));

  // The read-only API for the goals dashboard and calendar. Mounted after /health so a broken
  // data layer can never take the liveness probe down with it.
  app.use('/api', createApiRouter(options));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
