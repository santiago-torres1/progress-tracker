import { readFileSync } from 'node:fs';

/*
 * The version comes from this package's own package.json, resolved relative to this module
 * rather than the working directory. Both runtime layouts keep this file two levels below
 * the package root:
 *
 *   tsx / vitest:  backend/src/lib/version.ts       -> backend/package.json
 *   Lambda image:  /var/task/dist/lib/version.js     -> /var/task/package.json
 *
 * If this file moves, update the relative path (the tests will catch a mismatch).
 */
const PACKAGE_JSON_URL = new URL('../../package.json', import.meta.url);

function readPackageVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(PACKAGE_JSON_URL, 'utf8'));
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'version' in parsed &&
    typeof parsed.version === 'string'
  ) {
    return parsed.version;
  }
  throw new Error(`No string "version" field in ${PACKAGE_JSON_URL.pathname}`);
}

/**
 * Read once at import. A missing or malformed package.json throws here on purpose: in the
 * Lambda image that fails the cold start loudly (and the deploy smoke test with it) instead
 * of silently reporting a bogus version.
 */
export const APP_VERSION: string = readPackageVersion();
