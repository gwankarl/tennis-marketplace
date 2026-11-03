import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverEnv } from '../../../app/config/server-env.server';
import {
  loadUserProfile,
  runProfileAction,
} from '../../../app/features/identity/server/profile-action.server';
import { createSessionCsrfToken } from '../../../app/lib/security/csrf.server';

const credential = Buffer.alloc(32, 3).toString('base64url');
const cookie = `tx_session=${credential}`;

const profile = {
  firstName: 'Serena',
  lastName: 'Williams',
  email: 'player@example.test',
  emailVerified: true,
  createdAt: '2026-01-02T00:00:00.000Z',
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function request(
  fields: Record<string, string> = {},
  options: { withCookie?: boolean; origin?: string } = {},
): Request {
  const body = new URLSearchParams({
    _csrfToken: createSessionCsrfToken(credential),
    firstName: '  Serena ',
    lastName: ' Williams  ',
    ...fields,
  });

  return new Request(`${serverEnv.APP_ORIGIN}/profile`, {
    method: 'POST',
    headers: {
      origin: options.origin ?? serverEnv.APP_ORIGIN,
      'content-type': 'application/x-www-form-urlencoded',
      ...(options.withCookie === false ? {} : { cookie }),
    },
    body,
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('profile loader', () => {
  it('loads the profile server-side and never returns the session credential', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ data: { profile } }));

    const result = await loadUserProfile(
      new Request(`${serverEnv.APP_ORIGIN}/profile`, {
        headers: { cookie },
      }),
    );

    expect(result.data?.state).toBe('ready');
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(JSON.stringify(result)).not.toContain(credential);

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/api/v1/users/me');
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Bearer ${credential}`,
    );
  });

  it('redirects when no session cookie is present without calling the backend', async () => {
    const result = await loadUserProfile(
      new Request(`${serverEnv.APP_ORIGIN}/profile`),
    );

    expect(result.redirectTo).toBe('/login?returnTo=/profile');
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears an explicitly rejected session and redirects to login', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Private detail.',
          },
          meta: { requestId: 'private-request-id' },
        },
        401,
      ),
    );

    const result = await loadUserProfile(
      new Request(`${serverEnv.APP_ORIGIN}/profile`, {
        headers: { cookie },
      }),
    );

    expect(result.redirectTo).toBe('/login?returnTo=/profile');
    expect(result.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(JSON.stringify(result)).not.toMatch(
      /Private detail|private-request-id|credential/,
    );
  });

  it('keeps the session cookie when the backend is unavailable', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('private transport detail'));

    const result = await loadUserProfile(
      new Request(`${serverEnv.APP_ORIGIN}/profile`, {
        headers: { cookie },
      }),
    );

    expect(result.data).toMatchObject({ state: 'unavailable' });
    expect(result.headers.has('set-cookie')).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(
      /private transport detail|credential/,
    );
  });
});

describe('profile action', () => {
  it('validates session CSRF and sends only the two name fields using PATCH', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ data: { profile } }));

    const result = await runProfileAction(request());

    expect(result.data.success).toBe(true);
    expect(result.data.firstName).toBe('Serena');
    expect(result.data.lastName).toBe('Williams');
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(JSON.stringify(result)).not.toContain(credential);

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/api/v1/users/me');
    expect(init?.method).toBe('PATCH');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Bearer ${credential}`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      firstName: 'Serena',
      lastName: 'Williams',
    });
  });

  it('rejects an untrusted origin before calling the backend', async () => {
    const result = await runProfileAction(
      request({}, { origin: 'https://attacker.invalid' }),
    );

    expect(result.data.formError).toMatch(/form expired/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid names locally and retains safe form values', async () => {
    const result = await runProfileAction(
      request({ firstName: 'Name\nInjected' }),
    );

    expect(result.data.firstNameError).toBe('Enter a valid name.');
    expect(result.data.lastName).toBe('Williams');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps recognized backend field errors without exposing backend messages', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Private backend message.',
            details: [
              {
                field: 'firstName',
                code: 'FIELD_INVALID',
                message: 'Private field detail.',
              },
            ],
          },
          meta: { requestId: 'private-request-id' },
        },
        422,
      ),
    );

    const result = await runProfileAction(request());

    expect(result.data.firstNameError).toBe('Enter a valid first name.');
    expect(JSON.stringify(result)).not.toMatch(
      /Private backend message|Private field detail|private-request-id/,
    );
  });

  it('shows a safe failure and keeps the cookie during a backend outage', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Private backend detail.',
          },
          meta: { requestId: 'private-request-id' },
        },
        503,
      ),
    );

    const result = await runProfileAction(request());

    expect(result.data.formError).toMatch(/could not update your profile/i);
    expect(result.headers.has('set-cookie')).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(
      /Private backend detail|private-request-id|credential/,
    );
  });

  it('clears the cookie and redirects only when the backend rejects the session', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Private backend detail.',
          },
          meta: { requestId: 'private-request-id' },
        },
        401,
      ),
    );

    const result = await runProfileAction(request());

    expect(result.redirectTo).toBe('/login?returnTo=/profile');
    expect(result.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(JSON.stringify(result)).not.toMatch(
      /Private backend detail|private-request-id|credential/,
    );
  });
});
