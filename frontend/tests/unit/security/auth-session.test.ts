import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCurrentSession } from '../../../app/lib/security/auth-session.server';
import {
  clearSessionCookie,
  createSessionCookie,
  readSessionCredential,
} from '../../../app/lib/security/session-cookie.server';
import {
  returnToFromRequestUrl,
  safeReturnTo,
} from '../../../app/lib/security/return-to.server';

const credential = Buffer.alloc(32, 7).toString('base64url');
const sessionCookie = `tx_session=${credential}`;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('session cookie', () => {
  it('sets a host-only HttpOnly Lax cookie bounded by absolute expiry', () => {
    const cookie = createSessionCookie(
      credential,
      '2030-01-01T00:00:00.000Z',
      Date.parse('2029-12-31T23:59:00.000Z'),
    );

    expect(cookie).toContain(`tx_session=${credential}`);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=60');
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('adds Secure in production and clears with matching scope', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const cookie = createSessionCookie(
      credential,
      '2030-01-01T00:00:00.000Z',
      Date.parse('2029-12-31T23:59:00.000Z'),
    );

    expect(cookie).toContain('; Secure');
    expect(clearSessionCookie()).toContain('; Secure');
    expect(clearSessionCookie()).toContain('Path=/');
    expect(clearSessionCookie()).toContain('Max-Age=0');
  });

  it('rejects expired, malformed, and duplicate session cookies', () => {
    expect(
      createSessionCookie(
        credential,
        '2020-01-01T00:00:00.000Z',
        Date.parse('2021-01-01T00:00:00.000Z'),
      ),
    ).toBeNull();
    expect(readSessionCredential('tx_session=malformed')).toBeNull();
    expect(
      readSessionCredential(`${sessionCookie}; ${sessionCookie}`),
    ).toBeNull();
    expect(readSessionCredential(sessionCookie)).toBe(credential);
  });
});

describe('return destination validation', () => {
  it.each([
    ['external URL', 'https://attacker.invalid'],
    ['protocol-relative path', '//attacker.invalid/path'],
    ['encoded path', '%2F%2Fattacker.invalid'],
    ['backslash path', '\\\\attacker.invalid'],
    ['unknown internal route', '/admin'],
  ])('falls back for a %s', (_label, value) => {
    expect(safeReturnTo(value)).toBe('/account');
  });

  it('accepts only the literal approved buyer overview destination', () => {
    expect(safeReturnTo('/account')).toBe('/account');
    expect(
      returnToFromRequestUrl('http://localhost:5173/login?returnTo=/account'),
    ).toBe('/account');
  });

  it('rejects encoded and duplicate returnTo query values', () => {
    expect(
      returnToFromRequestUrl('http://localhost:5173/login?returnTo=%2Faccount'),
    ).toBe('/account');
    expect(
      returnToFromRequestUrl(
        'http://localhost:5173/login?returnTo=/account&returnTo=/account',
      ),
    ).toBe('/account');
  });
});

describe('server-side session restoration', () => {
  it('forwards the cookie credential only in Authorization and returns safe identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: {
            user: {
              id: '00000000-0000-4000-8000-000000000001',
              email: 'player@example.test',
              firstName: 'Test',
              lastName: 'Player',
              isAdministrator: false,
            },
          },
        }),
      ),
    );

    const result = await loadCurrentSession(sessionCookie);

    expect(result).toEqual({
      kind: 'authenticated',
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'player@example.test',
        firstName: 'Test',
        lastName: 'Player',
        isAdministrator: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain(credential);

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Bearer ${credential}`,
    );
    expect(new Headers(init?.headers).has('cookie')).toBe(false);
  });

  it('does not call the backend when no valid cookie is present', async () => {
    vi.stubGlobal('fetch', vi.fn());

    await expect(loadCurrentSession(null)).resolves.toEqual({
      kind: 'anonymous',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('treats a backend 401 as unauthenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Safe backend message.',
            },
            meta: { requestId: 'request-id' },
          },
          401,
        ),
      ),
    );

    await expect(loadCurrentSession(sessionCookie)).resolves.toEqual({
      kind: 'unauthenticated',
    });
  });

  it.each([
    [
      'network failure',
      vi.fn<typeof fetch>().mockRejectedValue(new Error('private')),
    ],
    [
      'backend outage',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Private backend detail.',
            },
            meta: { requestId: 'private-id' },
          },
          500,
        ),
      ),
    ],
  ])('keeps the session unresolved during a %s', async (_label, fetchMock) => {
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadCurrentSession(sessionCookie)).resolves.toEqual({
      kind: 'unavailable',
    });
  });
});
