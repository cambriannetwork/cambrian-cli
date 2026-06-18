/**
 * Tests for client error normalization in BaseClient.
 * Uses an injected fetch so no live API is hit.
 */

import { describe, it, expect } from 'vitest';
import { CambrianData } from '../src/client/index.js';
import { ApiError, mapStatusToCode, isRetryableStatus } from '../src/client/base-client.js';

function fetchReturning(opts: {
  status: number;
  body: string;
  contentType?: string;
}): typeof globalThis.fetch {
  return (async () =>
    new Response(opts.body, {
      status: opts.status,
      headers: { 'content-type': opts.contentType ?? 'application/json' },
    })) as unknown as typeof globalThis.fetch;
}

function clientWith(fetch: typeof globalThis.fetch): CambrianData {
  return new CambrianData({ apiKey: 'test-key', fetch });
}

describe('mapStatusToCode', () => {
  it('maps known statuses to stable codes', () => {
    expect(mapStatusToCode(401)).toBe('AUTH_REQUIRED');
    expect(mapStatusToCode(403)).toBe('AUTH_FORBIDDEN');
    expect(mapStatusToCode(404)).toBe('NOT_FOUND');
    expect(mapStatusToCode(408)).toBe('TIMEOUT');
    expect(mapStatusToCode(429)).toBe('RATE_LIMITED');
    expect(mapStatusToCode(400)).toBe('BAD_REQUEST');
    expect(mapStatusToCode(422)).toBe('BAD_REQUEST');
    expect(mapStatusToCode(500)).toBe('UPSTREAM_ERROR');
    expect(mapStatusToCode(502)).toBe('UPSTREAM_ERROR');
    expect(mapStatusToCode(418)).toBe('HTTP_ERROR');
  });

  it('prefers a server-provided code', () => {
    expect(mapStatusToCode(400, 'CUSTOM_CODE')).toBe('CUSTOM_CODE');
    expect(mapStatusToCode(500, '  SERVER_X ')).toBe('SERVER_X');
  });

  it('falls back to status mapping when server code is blank', () => {
    expect(mapStatusToCode(403, '')).toBe('AUTH_FORBIDDEN');
    expect(mapStatusToCode(403, '   ')).toBe('AUTH_FORBIDDEN');
  });
});

describe('isRetryableStatus', () => {
  it('flags 408/429/5xx as retryable', () => {
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });
});

describe('BaseClient error normalization', () => {
  it('403 JSON -> AUTH_FORBIDDEN, not retryable, JSON message preserved', async () => {
    const client = clientWith(
      fetchReturning({ status: 403, body: JSON.stringify({ message: 'Forbidden' }) }),
    );
    const err = await client.opabinia.query('/latest-block').then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.code).toBe('AUTH_FORBIDDEN');
    expect(err.retryable).toBe(false);
    expect(err.message).toContain('Forbidden');
  });

  it('502 HTML -> UPSTREAM_ERROR, retryable, no HTML in message', async () => {
    const html = '<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1></body></html>';
    const client = clientWith(
      fetchReturning({ status: 502, body: html, contentType: 'text/html' }),
    );
    const err = await client.opabinia.query('/latest-block').then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.code).toBe('UPSTREAM_ERROR');
    expect(err.retryable).toBe(true);
    expect(err.message).not.toContain('<!DOCTYPE');
    expect(err.message).not.toContain('<html');
    // Raw body retained for debugging only.
    expect(err.rawBody).toContain('502 Bad Gateway');
  });

  it('detects HTML by leading marker even with a wrong content-type', async () => {
    const html = '<html><head></head><body>nginx error</body></html>';
    const client = clientWith(
      fetchReturning({ status: 500, body: html, contentType: 'application/octet-stream' }),
    );
    const err = await client.opabinia.query('/latest-block').then(
      () => null,
      (e) => e,
    );
    expect(err.code).toBe('UPSTREAM_ERROR');
    expect(err.message).not.toContain('<html');
  });

  it('429 -> RATE_LIMITED, retryable', async () => {
    const client = clientWith(
      fetchReturning({ status: 429, body: JSON.stringify({ message: 'slow down' }) }),
    );
    const err = await client.opabinia.query('/latest-block').then(
      () => null,
      (e) => e,
    );
    expect(err.status).toBe(429);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryable).toBe(true);
  });

  it('400 -> BAD_REQUEST, not retryable', async () => {
    const client = clientWith(
      fetchReturning({ status: 400, body: JSON.stringify({ message: 'bad input' }) }),
    );
    const err = await client.opabinia.query('/latest-block').then(
      () => null,
      (e) => e,
    );
    expect(err.status).toBe(400);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.retryable).toBe(false);
  });

  it('preserves server-provided code in [code] message format', async () => {
    const client = clientWith(
      fetchReturning({ status: 400, body: JSON.stringify({ code: 'E_TOKEN', error: 'bad token' }) }),
    );
    const err = await client.opabinia.query('/latest-block').then(
      () => null,
      (e) => e,
    );
    expect(err.code).toBe('E_TOKEN');
    expect(err.message).toContain('[E_TOKEN]');
    expect(err.message).toContain('bad token');
  });

  it('aborts and raises a TIMEOUT ApiError when the request exceeds timeoutMs', async () => {
    const hangingFetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }
      })) as unknown as typeof globalThis.fetch;

    const client = new CambrianData({ apiKey: 'test-key', fetch: hangingFetch, timeoutMs: 20 });
    const err = await client.opabinia.query('/latest-block').then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('TIMEOUT');
    expect(err.status).toBe(408);
    expect(err.retryable).toBe(true);
  });
});
