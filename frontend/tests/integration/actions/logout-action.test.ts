import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverEnv } from '../../../app/config/server-env.server';
import { runLogoutAction } from '../../../app/features/identity/server/logout-action.server';
import {
  createCsrfToken,
  createSessionCsrfToken,
} from '../../../app/lib/security/csrf.server';

const credential = Buffer.alloc(32, 13).toString('base64url');

function makeRequest(token: string, origin = serverEnv.APP_ORIGIN): Request {
  const body = new URLSearchParams({ _csrfToken: token });

  return new Request(`${serverEnv.APP_ORIGIN}/account`, {
    method: 'POST',
    headers: {
      origin,
      cookie: `tx_session=${credential}`,
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('logout action', () => {
  it('revokes the current session, forwards its credential, and clears the cookie', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ data: { message: 'Logged out.' } })),
    );

    const result = await runLogoutAction(
      makeRequest(createSessionCsrfToken(credential)),
    );

    expect(result.redirectTo).toBe('/login?logout=success');
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(result.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(JSON.stringify(result)).not.toContain(credential);

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({});
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Bearer ${credential}`,
    );
  });

  it('clears the browser cookie and reports uncertain revocation on backend outage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new Error('private')),
    );

    const result = await runLogoutAction(
      makeRequest(createSessionCsrfToken(credential)),
    );

    expect(result.redirectTo).toBe('/login?logout=unconfirmed');
    expect(result.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(JSON.stringify(result)).not.toMatch(/private|credential-value/);
  });

  it('rejects a CSRF token not bound to the current session', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const result = await runLogoutAction(makeRequest(createCsrfToken()));

    expect(result.data?.formError).toMatch(/form expired/i);
    expect(result.redirectTo).toBeUndefined();
    expect(result.headers.has('set-cookie')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin logout without revoking or clearing the cookie', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const result = await runLogoutAction(
      makeRequest(
        createSessionCsrfToken(credential),
        'https://attacker.invalid',
      ),
    );

    expect(result.data?.formError).toMatch(/form expired/i);
    expect(result.headers.has('set-cookie')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
