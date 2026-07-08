/**
 * Tests for CLI error handling: exit codes, --json structured errors,
 * HTML suppression, and --timeout. Uses an injected fetch + runtime so no
 * live API is hit.
 */

import { describe, it, expect } from 'vitest';
import { runCli } from '../src/cli/index.js';
import type { Runtime } from '../src/cli/core.js';

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

function run(
  argv: string[],
  overrides: Partial<Runtime> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  return runCli(argv, {
    stdout: (line: string) => { stdout += line + '\n'; },
    stderr: (line: string) => { stderr += line + '\n'; },
    env: { CAMBRIAN_API_KEY: 'test-key' },
    ...overrides,
  }).then((code) => ({ code, stdout, stderr }));
}

describe('CLI exit codes', () => {
  it('400 BAD_REQUEST exits with code 2', async () => {
    const { code } = await run(['solana', 'latest-block'], {
      fetch: fetchReturning({ status: 400, body: JSON.stringify({ message: 'bad input' }) }),
    });
    expect(code).toBe(2);
  });

  it('403 exits with code 1', async () => {
    const { code } = await run(['solana', 'latest-block'], {
      fetch: fetchReturning({ status: 403, body: JSON.stringify({ message: 'Forbidden' }) }),
    });
    expect(code).toBe(1);
  });

  it('usage error exits with code 2', async () => {
    const { code } = await run(['solana', 'not-a-real-resource'], {
      fetch: fetchReturning({ status: 200, body: '{}' }),
    });
    expect(code).toBe(2);
  });
});

describe('CLI --json error output', () => {
  it('treats --json before the command as a global boolean flag', async () => {
    const { code, stderr } = await run(['--json', 'solana', 'latest-block'], {
      env: {},
      fetch: fetchReturning({ status: 200, body: '{}' }),
    });
    expect(code).toBe(2);
    const parsed = JSON.parse(stderr.trim());
    expect(parsed.error.code).toBe('USAGE_ERROR');
    expect(parsed.error.message).toContain('API key required');
    expect(parsed.error.message).not.toContain('Unknown command');
  });

  it('emits structured JSON on stderr for a 403 with no HTML', async () => {
    const html = '<!DOCTYPE html><html><body>403 Forbidden</body></html>';
    const { code, stderr } = await run(['solana', 'latest-block', '--json'], {
      fetch: fetchReturning({ status: 403, body: html, contentType: 'text/html' }),
    });
    expect(code).toBe(1);
    const parsed = JSON.parse(stderr.trim());
    expect(parsed.error.code).toBe('AUTH_FORBIDDEN');
    expect(parsed.error.status).toBe(403);
    expect(parsed.error.retryable).toBe(false);
    // No HTML leaks into the structured message.
    expect(stderr).not.toContain('<!DOCTYPE');
    expect(stderr).not.toContain('<html');
  });

  it('emits retryable=true with UPSTREAM_ERROR for a 502 HTML response', async () => {
    const html = '<!DOCTYPE html><html><body>502 Bad Gateway</body></html>';
    const { code, stderr } = await run(['solana', 'latest-block', '--json'], {
      fetch: fetchReturning({ status: 502, body: html, contentType: 'text/html' }),
    });
    expect(code).toBe(1);
    const parsed = JSON.parse(stderr.trim());
    expect(parsed.error.code).toBe('UPSTREAM_ERROR');
    expect(parsed.error.status).toBe(502);
    expect(parsed.error.retryable).toBe(true);
    expect(stderr).not.toContain('<!DOCTYPE');
  });

  it('emits structured JSON for a usage error', async () => {
    const { code, stderr } = await run(['solana', 'not-a-real-resource', '--json'], {
      fetch: fetchReturning({ status: 200, body: '{}' }),
    });
    expect(code).toBe(2);
    const parsed = JSON.parse(stderr.trim());
    expect(parsed.error.code).toBe('USAGE_ERROR');
    expect(parsed.error.retryable).toBe(false);
  });
});

describe('CLI default (non-json) error output stays plain text', () => {
  it('403 prints a plain message, not JSON', async () => {
    const { stderr } = await run(['solana', 'latest-block'], {
      fetch: fetchReturning({ status: 403, body: JSON.stringify({ message: 'Forbidden' }) }),
    });
    expect(stderr).toContain('Forbidden');
    expect(() => JSON.parse(stderr.trim())).toThrow();
  });

  it('429 prints the rate-limit message (revived 429 branch)', async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ message: 'slow down' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'Retry-After': '7' },
      })) as unknown as typeof globalThis.fetch;
    const { stderr } = await run(['solana', 'latest-block'], { fetch });
    expect(stderr).toContain('Rate limit exceeded');
    expect(stderr).toContain('7 seconds');
  });

  it('401 from an HTML gateway page prints the rejected-key guidance, not the sanitized upstream text', async () => {
    const html = '<!DOCTYPE html><html><body>401 Unauthorized</body></html>';
    const { code, stderr } = await run(['solana', 'latest-block'], {
      fetch: fetchReturning({ status: 401, body: html, contentType: 'text/html' }),
    });
    expect(code).toBe(1);
    expect(stderr).toContain('API key rejected (HTTP 401)');
    expect(stderr).toContain('cambrian config set-key');
    expect(stderr).toContain('CAMBRIAN_API_KEY');
    expect(stderr).not.toContain('non-JSON');
    expect(stderr).not.toContain('<html');
  });

  it('401 with a JSON body also prints the rejected-key guidance', async () => {
    const { code, stderr } = await run(['solana', 'latest-block'], {
      fetch: fetchReturning({ status: 401, body: JSON.stringify({ message: 'bad key' }) }),
    });
    expect(code).toBe(1);
    expect(stderr).toContain('API key rejected (HTTP 401)');
  });

  it('401 with --json keeps the structured AUTH_REQUIRED contract unchanged', async () => {
    const html = '<!DOCTYPE html><html><body>401</body></html>';
    const { code, stderr } = await run(['solana', 'latest-block', '--json'], {
      fetch: fetchReturning({ status: 401, body: html, contentType: 'text/html' }),
    });
    expect(code).toBe(1);
    const parsed = JSON.parse(stderr.trim());
    expect(parsed.error.code).toBe('AUTH_REQUIRED');
    expect(parsed.error.status).toBe(401);
    expect(parsed.error.retryable).toBe(false);
  });
});

describe('CLI --timeout', () => {
  it('rejects a bare --timeout with a usage error', async () => {
    const { code, stderr } = await run(
      ['solana', 'latest-block', '--timeout'],
      { fetch: fetchReturning({ status: 200, body: '{}' }) },
    );
    expect(code).toBe(2);
    expect(stderr).toContain('--timeout requires a value');
  });

  it('aborts a hanging request and reports TIMEOUT (retryable) via --json', async () => {
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

    const { code, stderr } = await run(
      ['solana', 'latest-block', '--timeout', '20', '--json'],
      { fetch: hangingFetch },
    );
    expect(code).toBe(1);
    const parsed = JSON.parse(stderr.trim());
    expect(parsed.error.code).toBe('TIMEOUT');
    expect(parsed.error.status).toBe(408);
    expect(parsed.error.retryable).toBe(true);
  });

  it('rejects a non-numeric --timeout with a usage error', async () => {
    const { code, stderr } = await run(
      ['solana', 'latest-block', '--timeout', 'abc'],
      { fetch: fetchReturning({ status: 200, body: '{}' }) },
    );
    expect(code).toBe(2);
    expect(stderr).toContain('--timeout');
  });
});

describe('CLI value-bearing global options', () => {
  it('rejects a bare --api-key even if an environment key exists', async () => {
    const { code, stderr } = await run(
      ['solana', 'latest-block', '--api-key'],
      { fetch: fetchReturning({ status: 200, body: '{}' }) },
    );
    expect(code).toBe(2);
    expect(stderr).toContain('--api-key requires a value');
  });

  it('rejects a bare --base-url before issuing a request', async () => {
    const { code, stderr } = await run(
      ['solana', 'latest-block', '--base-url'],
      { fetch: fetchReturning({ status: 200, body: '{}' }) },
    );
    expect(code).toBe(2);
    expect(stderr).toContain('--base-url requires a value');
  });
});

describe('CLI --json success output', () => {
  it('keeps JSON payload on stdout for a successful query', async () => {
    const payload = { columns: [], data: [], rows: 0 };
    const { code, stdout } = await run(['solana', 'latest-block', '--json'], {
      fetch: fetchReturning({ status: 200, body: JSON.stringify(payload) }),
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toMatchObject({ rows: 0 });
  });
});
