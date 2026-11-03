import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverEnv } from '../app/config/server-env.server';
import { runLoginAction } from '../app/features/identity/login-action.server';
import { createCsrfToken } from '../app/lib/csrf.server';

const credential = Buffer.alloc(32, 3).toString('base64url');

function request(
  overrides: Record<string, string> = {},
  origin = serverEnv.APP_ORIGIN,
): Request {
  const body = new URLSearchParams({
    _csrfToken: createCsrfToken(),
    _returnTo: '/account',
    email: ' Player+Tennis@Example.test ',
    password: '  exact password  ',
    ...overrides,
  });

  return new Request(`${serverEnv.APP_ORIGIN}/login`, {
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

const validLoginResponse = {
  data: {
    credential,
    absoluteExpiresAt: '2030-01-01T00:00:00.000Z',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      firstName: 'Test',
      lastName: 'Player',
      isAdministrator: false,
    },
  },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('login action', () => {
  it('normalizes email, preserves password, sets a host-only HttpOnly cookie, and redirects safely', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(validLoginResponse));

    const result = await runLoginAction(request());

    expect(result.redirectTo).toBe('/account');
    expect(result.data).toEqual({ email: '' });
    expect(JSON.stringify(result)).not.toContain(credential);
    expect(result.headers.get('cache-control')).toContain('no-store');

    const cookie = result.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('tx_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toMatch(/Domain=/i);

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/api/v1/auth/login');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'player+tennis@example.test',
      password: '  exact password  ',
    });
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });

  it('rejects an untrusted origin before calling the backend', async () => {
    const result = await runLoginAction(
      request({}, 'https://attacker.invalid'),
    );

    expect(result.data.formError).toMatch(/form expired/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects malformed email and oversized password without returning the password', async () => {
    const invalidEmail = await runLoginAction(
      request({ email: 'not-an-email' }),
    );
    const oversizedPassword = await runLoginAction(
      request({ password: 'x'.repeat(1025) }),
    );

    expect(invalidEmail.data.emailError).toBe('Enter a valid email address.');
    expect(oversizedPassword.data.passwordError).toBe('Password is too long.');
    expect(JSON.stringify(oversizedPassword)).not.toContain('x'.repeat(100));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a generic credential error without returning the password', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Untrusted backend detail.',
          },
          meta: { requestId: 'private-request-id' },
        },
        401,
      ),
    );

    const result = await runLoginAction(request());

    expect(result.data.formError).toBe('Email or password is incorrect.');
    expect(JSON.stringify(result)).not.toMatch(
      /exact password|Untrusted backend detail|private-request-id|credential/,
    );
  });

  it('offers resend only when the backend says verification is required', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'EMAIL_VERIFICATION_REQUIRED',
            message: 'Untrusted backend detail.',
          },
          meta: { requestId: 'private-request-id' },
        },
        403,
      ),
    );

    const result = await runLoginAction(request());

    expect(result.data.needsVerification).toBe(true);
    expect(result.data.formError).toMatch(/verify your email/i);
    expect(JSON.stringify(result)).not.toContain('private-request-id');
  });

  it.each([
    ['restricted account', 'ACCOUNT_RESTRICTED', 403],
    ['rate limit', 'RATE_LIMITED', 429],
    ['temporary backend failure', 'SERVICE_UNAVAILABLE', 503],
  ])('maps %s to safe UI copy', async (_name, code, status) => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: { code, message: 'Private server detail.' },
          meta: { requestId: 'private-request-id' },
        },
        status,
      ),
    );

    const result = await runLoginAction(request());

    expect(result.data.formError).toBeTruthy();
    expect(JSON.stringify(result)).not.toMatch(
      /Private server detail|private-request-id|exact password/,
    );
  });

  it('keeps the cookie unset when backend response validation fails', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        data: {
          credential,
          absoluteExpiresAt: 'not-a-date',
          user: {},
        },
      }),
    );

    const result = await runLoginAction(request());

    expect(result.redirectTo).toBeUndefined();
    expect(result.headers.has('set-cookie')).toBe(false);
    expect(JSON.stringify(result)).not.toContain(credential);
  });

  it('uses a safe fallback for a tampered return destination', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(validLoginResponse));

    const result = await runLoginAction(
      request({ _returnTo: '//attacker.invalid/path' }),
    );

    expect(result.redirectTo).toBe('/account');
  });
});
