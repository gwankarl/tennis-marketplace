import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverEnv } from '../app/config/server-env.server';
import { createCsrfToken } from '../app/lib/csrf.server';
import { runResendVerificationAction } from '../app/features/identity/resend-verification-action.server';

const acknowledgement = {
  data: {
    message: 'If an account needs verification, instructions may be sent.',
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

  return new Request(`${serverEnv.APP_ORIGIN}/resend-verification`, {
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

describe('resend verification action', () => {
  it('normalizes email and returns the generic acknowledgement state', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(acknowledgement));

    const result = await runResendVerificationAction(makeRequest());

    expect(result).toEqual({ email: '', success: true });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/api/v1/auth/resend-verification');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'player+tennis@example.test',
    });
  });

  it('rejects malformed email before calling the backend', async () => {
    const result = await runResendVerificationAction(
      makeRequest({ email: 'not-an-email' }),
    );

    expect(result.emailError).toBe('Enter a valid email address.');
    expect(result.email).toBe('not-an-email');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects cross-origin submissions before calling the backend', async () => {
    const result = await runResendVerificationAction(
      makeRequest({}, 'https://attacker.invalid'),
    );

    expect(result.formError).toMatch(/form expired/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps backend email validation to a safe field error', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Private backend message.',
            details: [
              {
                field: 'email',
                code: 'FIELD_INVALID',
                message: 'Untrusted detail.',
              },
            ],
          },
          meta: { requestId: 'private-request-id' },
        },
        422,
      ),
    );

    const result = await runResendVerificationAction(makeRequest());

    expect(result.emailError).toBe('Enter a valid email address.');
    expect(JSON.stringify(result)).not.toMatch(
      /Private backend message|Untrusted detail|private-request-id/,
    );
  });

  it('maps IP rate limiting without exposing a limit duration or account state', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Private backend message.',
          },
          meta: { requestId: 'private-request-id' },
        },
        429,
      ),
    );

    const result = await runResendVerificationAction(makeRequest());

    expect(result.formError).toBe(
      'Too many requests. Please wait and try again later.',
    );
    expect(result.email).toBe('Player+Tennis@Example.test');
    expect(JSON.stringify(result)).not.toMatch(
      /private-request-id|Private backend message|account|60 seconds|one hour/i,
    );
  });

  it.each([
    ['backend outage', 503],
    ['unexpected backend response', 500],
  ])('shows a safe temporary error for a %s', async (_label, status) => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: status === 503 ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR',
            message: 'Private infrastructure detail.',
          },
          meta: { requestId: 'private-request-id' },
        },
        status,
      ),
    );

    const result = await runResendVerificationAction(makeRequest());

    expect(result.formError).toMatch(/try again later/i);
    expect(JSON.stringify(result)).not.toMatch(
      /Private infrastructure detail|private-request-id/,
    );
  });

  it('shows a safe message for network failures', async () => {
    vi.mocked(fetch).mockRejectedValue(
      new Error('internal-url-and-credentials-must-not-leak'),
    );

    const result = await runResendVerificationAction(makeRequest());

    expect(result.formError).toMatch(/try again later/i);
    expect(JSON.stringify(result)).not.toMatch(
      /internal-url|credentials|must-not-leak/,
    );
  });

  it('shows a safe message when the request times out', async () => {
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

    const pending = runResendVerificationAction(makeRequest());

    await vi.advanceTimersByTimeAsync(5_001);

    const result = await pending;

    expect(result.formError).toMatch(/try again later/i);
    expect(JSON.stringify(result)).not.toMatch(/Aborted|AbortError/);
  });

  it('handles an invalid success response without exposing its contents', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        data: { message: 'Unexpected account-specific response.' },
      }),
    );

    const result = await runResendVerificationAction(makeRequest());

    expect(result.formError).toMatch(/try again later/i);
    expect(JSON.stringify(result)).not.toContain(
      'Unexpected account-specific response.',
    );
  });
});
