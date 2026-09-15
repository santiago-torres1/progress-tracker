import { describe, expect, it, vi } from 'vitest';
import { apiUrl, fetchHealth } from './health';

const okPayload = {
  status: 'ok',
  version: '0.1.0-alpha',
  commit: 'abc1234',
  timestamp: '2026-09-14T12:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('apiUrl', () => {
  it('uses a same-origin path when the base is empty', () => {
    expect(apiUrl('/health', '')).toBe('/health');
  });

  it('strips trailing slashes from the base', () => {
    expect(apiUrl('/health', 'https://abc.lambda-url.us-east-1.on.aws/')).toBe(
      'https://abc.lambda-url.us-east-1.on.aws/health',
    );
  });
});

describe('fetchHealth', () => {
  it('passes when the payload has the expected shape', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(okPayload));
    const result = await fetchHealth({ fetchImpl });
    expect(result).toMatchObject({ kind: 'pass', payload: okPayload });
  });

  it('fails on a non-2xx status', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 502));
    const result = await fetchHealth({ fetchImpl });
    expect(result).toMatchObject({ kind: 'fail', reason: 'HTTP 502' });
  });

  it('fails when the body is not a health payload (e.g. the SPA index.html)', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<!doctype html>', { status: 200 }));
    const result = await fetchHealth({ fetchImpl });
    expect(result).toMatchObject({ kind: 'fail', reason: 'Unexpected response shape' });
  });

  it('fails on a network error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await fetchHealth({ fetchImpl });
    expect(result).toMatchObject({ kind: 'fail', reason: 'Network error' });
  });

  it('rethrows when the caller aborts', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });
    await expect(fetchHealth({ fetchImpl, signal: controller.signal })).rejects.toThrow();
  });
});
