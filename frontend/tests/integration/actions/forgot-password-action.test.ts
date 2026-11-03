import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverEnv } from '../../../app/config/server-env.server';
import { createCsrfToken } from '../../../app/lib/security/csrf.server';
import { runForgotPasswordAction } from '../../../app/features/identity/server/forgot-password-action.server';

const acknowledgement = {
  data: {
    message:
      'If an account is eligible for a password reset, instructions may be sent.',
  },
};

function makeRequest(
  overrides: Record<string, string> = {},
  origin = serverEnv.APP_ORIGIN,
): Request {
  const body = new URLSearchParams({
    _csrfToken: createCsrfToken(),
    email: ' Player+Tennis@Example.test ',
    ...overrides,
  });

  return new Request(`${serverEnv.APP_ORIGIN}/forgot-password`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/x-www-form-urlencoded',
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

describe('forgot-password action', () => {
  it('normalizes email and returns only the generic acknowledgement state', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(acknowledgement));

    const result = await runForgotPasswordAction(makeRequest());

    expect(result.data).toEqual({ email: '', success: true });
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(result.headers.get('referrer-policy')).toBe('no-referrer');
    expect(JSON.stringify(result)).not.toContain('Player+Tennis@Example.test');

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/api/v1/auth/request-password-reset');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'player+tennis@example.test',
    });
  });

  it('rejects malformed email before calling the backend', async () => {
    const result = await runForgotPasswordAction(
      makeRequest({ email: 'not-an-email' }),
    );

    expect(result.data.emailError).toBe('Enter a valid email address.');
    expect(result.data.email).toBe('not-an-email');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects cross-origin and invalid CSRF submissions before calling the backend', async () => {
    const crossOrigin = await runForgotPasswordAction(
      makeRequest({}, 'https://attacker.invalid'),
    );
    const invalidCsrf = await runForgotPasswordAction(
      makeRequest({ _csrfToken: 'invalid-csrf-token' }),
    );

    expect(crossOrigin.data.formError).toMatch(/form expired/i);
    expect(invalidCsrf.data.formError).toMatch(/form expired/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps recognized backend email validation to safe field copy', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Untrusted backend text.',
            details: [
              {
                field: 'email',
                code: 'FIELD_INVALID',
                message: 'Untrusted field detail.',
              },
            ],
          },
          meta: { requestId: 'private-request-id' },
        },
        422,
      ),
    );

    const result = await runForgotPasswordAction(makeRequest());

    expect(result.data.emailError).toBe('Enter a valid email address.');
    expect(JSON.stringify(result)).not.toMatch(
      /Untrusted backend text|Untrusted field detail|private-request-id/,
    );
  });

  it('maps IP rate limiting without exposing account limits or retry duration', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Untrusted backend text.',
          },
          meta: { requestId: 'private-request-id' },
        },
        429,
      ),
    );

    const result = await runForgotPasswordAction(makeRequest());

    expect(result.data.formError).toBe(
      'Too many requests. Please wait and try again later.',
    );
    expect(JSON.stringify(result)).not.toMatch(
      /private-request-id|Untrusted backend text|account|60 seconds|one hour/i,
    );
  });

  it('uses safe copy for backend, network, and invalid-response failures', async () => {
    const unavailable = await runForgotPasswordAction(makeRequest());

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
    const backendFailure = await runForgotPasswordAction(makeRequest());

    vi.mocked(fetch).mockRejectedValue(
      new Error('internal-url-and-credentials-must-not-leak'),
    );
    const networkFailure = await runForgotPasswordAction(makeRequest());

    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ data: { message: 'Unexpected private response.' } }),
    );
    const invalidResponse = await runForgotPasswordAction(makeRequest());

    for (const result of [
      unavailable,
      backendFailure,
      networkFailure,
      invalidResponse,
    ]) {
      expect(result.data.formError).toMatch(/try again later/i);
      expect(JSON.stringify(result)).not.toMatch(
        /Private infrastructure|private-request-id|internal-url|credentials|Unexpected private/,
      );
    }
  });

  it('maps timeouts to safe retryable copy', async () => {
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

    const pending = runForgotPasswordAction(makeRequest());
    await vi.advanceTimersByTimeAsync(5_001);
    const result = await pending;

    expect(result.data.formError).toMatch(/try again later/i);
    expect(JSON.stringify(result)).not.toMatch(/Aborted|AbortError/);
  });
});
