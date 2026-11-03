import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverEnv } from '../../../app/config/server-env.server';
import { createCsrfToken } from '../../../app/lib/security/csrf.server';
import { submitPasswordReset } from '../../../app/features/identity/server/password-reset-flow.server';

const token = 'A'.repeat(43);
const cookie = `tx_password_reset_stage=${token}`;
const password = '  correct horse battery staple  ';
const successBody = { data: { message: 'Password reset complete.' } };

function postRequest(
  options: {
    origin?: string;
    csrfToken?: string;
    cookie?: string;
    password?: string;
    confirmPassword?: string;
    method?: 'GET' | 'POST' | 'HEAD';
  } = {},
): Request {
  const method = options.method ?? 'POST';
  const body = new URLSearchParams({
    _csrfToken: options.csrfToken ?? createCsrfToken(),
    password: options.password ?? password,
    confirmPassword: options.confirmPassword ?? options.password ?? password,
  });
  const hasBody = method !== 'GET' && method !== 'HEAD';

  return new Request(`${serverEnv.APP_ORIGIN}/reset-password`, {
    method,
    headers: {
      origin: options.origin ?? serverEnv.APP_ORIGIN,
      ...(hasBody
        ? { 'content-type': 'application/x-www-form-urlencoded' }
        : {}),
      ...(options.cookie === undefined
        ? { cookie }
        : { cookie: options.cookie }),
    },
    ...(hasBody ? { body } : {}),
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('password reset action', () => {
  it('forwards the staged token and exact matching password, then clears both cookies', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(successBody));

    const result = await submitPasswordReset(postRequest());

    expect(result.data).toEqual({ state: 'success' });
    expect(JSON.stringify(result.data)).not.toContain(token);
    expect(JSON.stringify(result.data)).not.toContain(password);
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(result.headers.get('referrer-policy')).toBe('no-referrer');

    const setCookie = result.headers.get('set-cookie');
    expect(setCookie).toContain('tx_password_reset_stage=');
    expect(setCookie).toContain('tx_session=');
    expect(setCookie).toContain('Max-Age=0');

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/api/v1/auth/confirm-password-reset');
    expect(String(url)).not.toContain(token);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ token, password });
  });

  it('rejects a short password without calling the backend or returning it', async () => {
    const result = await submitPasswordReset(
      postRequest({ password: 'short', confirmPassword: 'short' }),
    );

    expect(result.data.state).toBe('validation-error');
    expect(result.data.passwordError).toMatch(/15 and 128/);
    expect(JSON.stringify(result.data)).not.toContain('short');
    expect(fetch).not.toHaveBeenCalled();
    expect(result.headers.get('set-cookie')).toBeNull();
  });

  it('rejects mismatched passwords without calling the backend or returning either value', async () => {
    const result = await submitPasswordReset(
      postRequest({
        password,
        confirmPassword: 'a different password value',
      }),
    );

    expect(result.data.state).toBe('validation-error');
    expect(result.data.confirmPasswordError).toBe('Passwords do not match.');
    expect(JSON.stringify(result.data)).not.toContain(password);
    expect(JSON.stringify(result.data)).not.toContain(
      'a different password value',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects cross-origin and invalid CSRF submissions before the API call', async () => {
    const crossOrigin = await submitPasswordReset(
      postRequest({ origin: 'https://attacker.invalid' }),
    );
    const invalidCsrf = await submitPasswordReset(
      postRequest({ csrfToken: 'invalid-csrf-token' }),
    );

    expect(crossOrigin.data.state).toBe('csrf-failure');
    expect(invalidCsrf.data.state).toBe('csrf-failure');
    expect(fetch).not.toHaveBeenCalled();
    expect(crossOrigin.headers.get('set-cookie')).toBeNull();
    expect(invalidCsrf.headers.get('set-cookie')).toBeNull();
  });

  it('does not call the API when the staged token is absent', async () => {
    const result = await submitPasswordReset(postRequest({ cookie: '' }));

    expect(result.data.state).toBe('missing');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears only the staged token after a definitive invalid or expired response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Private backend message.',
          },
          meta: { requestId: 'private-request-id' },
        },
        404,
      ),
    );

    const result = await submitPasswordReset(postRequest());

    expect(result.data.state).toBe('invalid');
    expect(result.headers.get('set-cookie')).toContain(
      'tx_password_reset_stage=',
    );
    expect(result.headers.get('set-cookie')).not.toContain('tx_session=');
    expect(JSON.stringify(result.data)).not.toMatch(
      /Private backend|private-request-id|token|password/i,
    );
  });

  it('maps a compromised-password response safely and retains the staged token', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Untrusted backend message.',
            details: [
              {
                field: 'password',
                code: 'PASSWORD_COMPROMISED',
                message: 'Untrusted field message.',
              },
            ],
          },
          meta: { requestId: 'private-request-id' },
        },
        422,
      ),
    );

    const result = await submitPasswordReset(postRequest());

    expect(result.data).toEqual({
      state: 'validation-error',
      passwordError: 'Choose a different password.',
    });
    expect(result.headers.get('set-cookie')).toBeNull();
    expect(JSON.stringify(result.data)).not.toMatch(
      /Untrusted|private-request-id|correct horse|token/i,
    );
  });

  it('shows a generic rate-limit state without account-limit details', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: { code: 'RATE_LIMITED', message: 'Private message.' },
          meta: { requestId: 'private-request-id' },
        },
        429,
      ),
    );

    const result = await submitPasswordReset(postRequest());

    expect(result.data.state).toBe('rate-limited');
    expect(result.data.formError).toMatch(/wait and try again/i);
    expect(JSON.stringify(result.data)).not.toMatch(
      /Private message|private-request-id|account|60 seconds|one hour/i,
    );
    expect(result.headers.get('set-cookie')).toBeNull();
  });

  it('retains the staged token and returns safe temporary-failure state', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Private infrastructure detail.',
          },
          meta: { requestId: 'private-request-id' },
        },
        503,
      ),
    );

    const result = await submitPasswordReset(postRequest());

    expect(result.data.state).toBe('temporary-failure');
    expect(result.data.formError).toMatch(/try again later/i);
    expect(result.headers.get('set-cookie')).toBeNull();
    expect(JSON.stringify(result.data)).not.toMatch(
      /Private infrastructure|private-request-id|correct horse|token/i,
    );
  });

  it('retains the staged token after a network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(
      new Error('internal-url-and-credentials-must-not-leak'),
    );

    const result = await submitPasswordReset(postRequest());

    expect(result.data.state).toBe('temporary-failure');
    expect(result.headers.get('set-cookie')).toBeNull();
    expect(JSON.stringify(result.data)).not.toMatch(
      /internal-url|credentials|must-not-leak|correct horse|token/i,
    );
  });

  it('retains the staged token after a request timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          }),
      ),
    );

    const pending = submitPasswordReset(postRequest());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_001);

    const result = await pending;

    expect(result.data.state).toBe('temporary-failure');
    expect(result.headers.get('set-cookie')).toBeNull();
    expect(JSON.stringify(result.data)).not.toMatch(
      /Aborted|AbortError|correct horse|token/i,
    );
  });

  it('treats an invalid success response as temporary and retains the staged token', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        data: { message: 'Unexpected private response.' },
      }),
    );

    const result = await submitPasswordReset(postRequest());

    expect(result.data.state).toBe('temporary-failure');
    expect(result.headers.get('set-cookie')).toBeNull();
    expect(JSON.stringify(result.data)).not.toMatch(
      /Unexpected private|correct horse|token/i,
    );
  });

  it('rejects non-POST submissions without contacting the backend', async () => {
    const result = await submitPasswordReset(postRequest({ method: 'GET' }));

    expect(result.data.state).toBe('csrf-failure');
    expect(fetch).not.toHaveBeenCalled();
  });
});
