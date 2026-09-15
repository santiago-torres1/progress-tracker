import express, { type Express } from 'express';

import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { createHealthRouter, type HealthRouterOptions } from './routes/health.js';

export type AppOptions = HealthRouterOptions;

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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
