import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverEnv } from '../../../app/config/server-env.server';
import { createCsrfToken } from '../../../app/lib/security/csrf.server';
import {
  loadEmailVerificationPage,
  submitEmailVerification,
} from '../../../app/features/identity/server/email-verification-flow.server';

const token = 'A'.repeat(43);
const cookie = `tx_email_verification_stage=${token}`;
const successBody = {
  data: { message: 'Email address verified.' },
};

function postRequest(
  options: {
    origin?: string;
    csrfToken?: string;
    cookie?: string;
  } = {},
): Request {
  const body = new URLSearchParams({
    _csrfToken: options.csrfToken ?? createCsrfToken(),
  });

  return new Request(`${serverEnv.APP_ORIGIN}/verify-email`, {
    method: 'POST',
    headers: {
      origin: options.origin ?? serverEnv.APP_ORIGIN,
      'content-type': 'application/x-www-form-urlencoded',
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    body,
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

describe('email verification page flow', () => {
  it('stages a valid token and redirects to the clean confirmation URL without calling the backend', () => {
    const result = loadEmailVerificationPage(
      new Request(`${serverEnv.APP_ORIGIN}/verify-email?token=${token}`),
    );

    expect(result.redirectTo).toBe('/verify-email');
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(result.headers.get('referrer-policy')).toBe('strict-origin');
    expect(result.headers.get('set-cookie')).toContain(`${cookie}`);
    expect(result.headers.get('set-cookie')).toContain('HttpOnly');
    expect(result.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(result.headers.get('set-cookie')).toContain('Path=/verify-email');
    expect(result.headers.get('set-cookie')).toContain('Max-Age=900');
    expect(JSON.stringify(result.data)).not.toContain(token);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a ready page from the staging cookie without returning its token', () => {
    const result = loadEmailVerificationPage(
      new Request(`${serverEnv.APP_ORIGIN}/verify-email`, {
        headers: { cookie },
      }),
    );

    expect(result.data.state).toBe('ready');
    expect(result.data.csrfToken).toMatch(/^\d{10}\./);
    expect(JSON.stringify(result.data)).not.toContain(token);
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(result.headers.get('referrer-policy')).toBe('strict-origin');
  });

  it('redirects malformed token links without retaining their token', () => {
    const malformed = 'not-a-verification-token';
    const result = loadEmailVerificationPage(
      new Request(`${serverEnv.APP_ORIGIN}/verify-email?token=${malformed}`),
    );

    expect(result.redirectTo).toBe('/verify-email?state=invalid');
    expect(result.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(result.redirectTo).not.toContain(malformed);
    expect(JSON.stringify(result.data)).not.toContain(malformed);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows missing state without a staged token', () => {
    const result = loadEmailVerificationPage(
      new Request(`${serverEnv.APP_ORIGIN}/verify-email`),
    );

    expect(result.data.state).toBe('missing');
    expect(JSON.stringify(result.data)).not.toContain(token);
  });

  it('submits the staged token only in the backend POST body and clears it on success', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(successBody));

    const result = await submitEmailVerification(
      postRequest({ cookie }),
      createCsrfToken(),
    );

    expect(result.data.state).toBe('success');
    expect(JSON.stringify(result.data)).not.toContain(token);
    expect(result.headers.get('set-cookie')).toContain('Max-Age=0');

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/api/v1/auth/verify-email');
    expect(String(url)).not.toContain(token);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ token });
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(result.headers.get('referrer-policy')).toBe('strict-origin');
  });

  it('maps invalid, expired, and used backend tokens to one safe state and clears the cookie', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'This verification link is invalid or expired.',
          },
          meta: { requestId: 'verify-request-1' },
        },
        404,
      ),
    );

    const result = await submitEmailVerification(
      postRequest({ cookie }),
      createCsrfToken(),
    );

    expect(result.data.state).toBe('invalid');
    expect(JSON.stringify(result.data)).not.toContain(token);
    expect(result.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('keeps the staged cookie and shows a safe state for backend and network failures', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Private infrastructure detail.',
          },
          meta: { requestId: 'verify-request-2' },
        },
        503,
      ),
    );

    const backendFailure = await submitEmailVerification(
      postRequest({ cookie }),
      createCsrfToken(),
    );
    expect(backendFailure.data.state).toBe('temporary-failure');
    expect(backendFailure.headers.get('set-cookie')).toBeNull();
    expect(JSON.stringify(backendFailure.data)).not.toContain(token);
    expect(JSON.stringify(backendFailure.data)).not.toContain(
      'Private infrastructure detail.',
    );

    vi.mocked(fetch).mockRejectedValue(
      new Error('internal-url-and-credentials-must-not-leak'),
    );

    const networkFailure = await submitEmailVerification(
      postRequest({ cookie }),
      createCsrfToken(),
    );
    expect(networkFailure.data.state).toBe('temporary-failure');
    expect(JSON.stringify(networkFailure.data)).not.toMatch(
      /internal-url|credentials|must-not-leak/,
    );
    expect(networkFailure.headers.get('set-cookie')).toBeNull();
  });

  it('maps request timeouts to a retryable safe state', async () => {
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

    const pending = submitEmailVerification(
      postRequest({ cookie }),
      createCsrfToken(),
    );

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_001);

    const result = await pending;
    expect(result.data.state).toBe('temporary-failure');
    expect(result.headers.get('set-cookie')).toBeNull();
    expect(JSON.stringify(result.data)).not.toContain(token);
  });

  it('rejects cross-origin and invalid CSRF submissions before the API call', async () => {
    const crossOrigin = await submitEmailVerification(
      postRequest({ cookie, origin: 'https://attacker.invalid' }),
      createCsrfToken(),
    );
    const badCsrf = await submitEmailVerification(
      postRequest({ cookie, csrfToken: 'invalid-csrf' }),
      createCsrfToken(),
    );

    expect(crossOrigin.data.state).toBe('csrf-failure');
    expect(badCsrf.data.state).toBe('csrf-failure');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('handles a missing staging cookie without contacting the backend', async () => {
    const result = await submitEmailVerification(
      postRequest(),
      createCsrfToken(),
    );

    expect(result.data.state).toBe('missing');
    expect(fetch).not.toHaveBeenCalled();
  });
});
