/**
 * Reads an environment variable, treating unset, empty, and whitespace-only values as absent.
 *
 * Empty values are the normal result of copying `.env.example` without filling it in, and a
 * stray trailing newline in a CI secret should not turn into a different value.
 */
export function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}
