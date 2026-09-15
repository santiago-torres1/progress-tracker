import { fileURLToPath } from 'node:url';

import { readEnv } from './lib/env.js';

/*
 * Local entrypoint (`npm run dev`, `npm start`). Lambda uses src/lambda.ts instead, which never
 * reads .env: in AWS, configuration comes from the function's environment variables.
 */

const DEFAULT_PORT = 3001;

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/** Loads backend/.env if it exists. Variables already set in the shell take precedence. */
function loadLocalEnvFile(): void {
  // Resolved from this file (src/ or dist/), so it works regardless of the working directory.
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));
  try {
    process.loadEnvFile(envPath);
    console.log('[server] loaded environment from backend/.env');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return;
    throw error;
  }
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`PORT must be an integer between 0 and 65535, got "${raw}"`);
  }
  return port;
}

loadLocalEnvFile();

// Imported only after .env is loaded. A static import would be hoisted above the call above, so
// any module reading process.env at import time would miss the .env values.
const { createApp } = await import('./app.js');

const port = parsePort(readEnv('PORT'));

createApp().listen(port, (error) => {
  if (error) {
    console.error(`[server] failed to listen on port ${port}`, error);
    process.exit(1);
  }
  console.log(`[server] listening on http://localhost:${port}`);
});
