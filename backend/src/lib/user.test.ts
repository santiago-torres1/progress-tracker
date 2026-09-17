import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_USER_ID, getDefaultUserId, InvalidUserConfigError } from './user.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getDefaultUserId', () => {
  it('falls back to the id reference_data.sql inserts', () => {
    vi.stubEnv('DEFAULT_USER_ID', undefined);

    expect(getDefaultUserId()).toBe('00000000-0000-4000-8000-000000000001');
    expect(DEFAULT_USER_ID).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('treats an empty variable as unset, so a blank line in .env is harmless', () => {
    vi.stubEnv('DEFAULT_USER_ID', '  ');

    expect(getDefaultUserId()).toBe(DEFAULT_USER_ID);
  });

  it('uses a valid override', () => {
    vi.stubEnv('DEFAULT_USER_ID', '3f1b2c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d');

    expect(getDefaultUserId()).toBe('3f1b2c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d');
  });

  it("refuses a malformed override rather than reading the wrong person's data", () => {
    vi.stubEnv('DEFAULT_USER_ID', 'me');

    expect(() => getDefaultUserId()).toThrow(InvalidUserConfigError);
  });

  it('never puts the value in the error message', () => {
    vi.stubEnv('DEFAULT_USER_ID', 'not-a-uuid-but-sensitive');

    expect(() => getDefaultUserId()).toThrow(/^DEFAULT_USER_ID is not a valid UUID$/);
  });
});
