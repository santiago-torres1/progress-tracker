import { describe, expect, it } from 'vitest';

import { readBearerToken, UnauthorizedError } from './session.js';

/*
 * readBearerToken is the only part of the identity layer that makes a decision without asking
 * Supabase, so it is the only part worth unit-testing here: everything else about a session is
 * decided by PostgREST and public.begin_request(), and is covered by the route tests (mocked)
 * and the psql transcripts (real).
 *
 * It is a SHAPE check, not a verification. These tests exist to pin that distinction down: a
 * well-formed forgery must get through, because the thing that rejects it is Supabase.
 */

const WELL_FORMED = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2aXNpdG9yIn0.c2lnbmF0dXJl';

describe('readBearerToken', () => {
  it('reads a bearer token', () => {
    expect(readBearerToken(`Bearer ${WELL_FORMED}`)).toBe(WELL_FORMED);
  });

  it('accepts the scheme in any case, as RFC 9110 requires', () => {
    expect(readBearerToken(`bearer ${WELL_FORMED}`)).toBe(WELL_FORMED);
    expect(readBearerToken(`BEARER ${WELL_FORMED}`)).toBe(WELL_FORMED);
  });

  it('tolerates surrounding whitespace and a tab separator', () => {
    expect(readBearerToken(`  Bearer\t${WELL_FORMED}  `)).toBe(WELL_FORMED);
  });

  it.each([
    ['nothing at all', undefined],
    ['an empty header', ''],
    ['only whitespace', '   '],
  ])('reports missing_token for %s', (_case, header) => {
    expect(() => readBearerToken(header)).toThrow(
      expect.objectContaining({ reason: 'missing_token' }) as Error,
    );
  });

  it.each([
    ['a bare token', WELL_FORMED],
    ['the wrong scheme', `Basic ${WELL_FORMED}`],
    ['a scheme with no token', 'Bearer'],
    ['two segments', 'Bearer aaa.bbb'],
    ['four segments', 'Bearer aaa.bbb.ccc.ddd'],
    ['an empty segment', 'Bearer aaa..ccc'],
    ['a segment outside base64url', 'Bearer aaa.b+b/b.ccc'],
    ['a second token after the first', `Bearer ${WELL_FORMED} extra`],
  ])('reports malformed_token for %s', (_case, header) => {
    expect(() => readBearerToken(header)).toThrow(
      expect.objectContaining({ reason: 'malformed_token' }) as Error,
    );
  });

  it('lets a well-formed forgery through — Supabase is what rejects it', () => {
    // No signature verification happens here, on purpose: PostgREST checks it against the
    // project key, and duplicating that check in TypeScript would be a second thing to get wrong.
    expect(readBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('never puts the token in the error message', () => {
    try {
      readBearerToken('Bearer sensitive-looking-garbage');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedError);
      expect((error as Error).message).toBe('Unauthorized: malformed_token');
      expect((error as Error).message).not.toContain('sensitive');
    }
  });
});
