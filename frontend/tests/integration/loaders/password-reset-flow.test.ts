import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverEnv } from '../../../app/config/server-env.server';
import { loadPasswordResetPage } from '../../../app/features/identity/server/password-reset-flow.server';

const token = 'A'.repeat(43);
const cookieName = 'tx_password_reset_stage';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('password reset token staging', () => {
  it('stages a valid link token in a separate HttpOnly cookie and redirects cleanly', () => {
    const result = loadPasswordResetPage(
      new Request(`${serverEnv.APP_ORIGIN}/reset-password?token=${token}`),
    );

    expect(result.redirectTo).toBe('/reset-password');
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(result.headers.get('referrer-policy')).toBe('no-referrer');

    const setCookie = result.headers.get('set-cookie');
    expect(setCookie).toContain(`${cookieName}=${token}`);
    expect(setCookie).toContain('Path=/reset-password');
    expect(setCookie).toContain('Max-Age=1800');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    if (process.env.NODE_ENV === 'production') {
      expect(setCookie).toContain('Secure');
    }

    expect(result.data.state).toBe('ready');
    expect(JSON.stringify(result.data)).not.toContain(token);
    expect(result.redirectTo).not.toContain(token);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loads ready state from the staging cookie without returning the token', () => {
    const result = loadPasswordResetPage(
      new Request(`${serverEnv.APP_ORIGIN}/reset-password`, {
        headers: { cookie: `${cookieName}=${token}` },
      }),
    );

    expect(result.data.state).toBe('ready');
    expect(result.data.csrfToken).toMatch(/^\d{10}\./);
    expect(JSON.stringify(result.data)).not.toContain(token);
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(result.headers.get('referrer-policy')).toBe('no-referrer');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects malformed and repeated link tokens without retaining them', () => {
    const malformed = 'not-a-reset-token';
    const malformedResult = loadPasswordResetPage(
      new Request(`${serverEnv.APP_ORIGIN}/reset-password?token=${malformed}`),
    );
    const repeatedResult = loadPasswordResetPage(
      new Request(
        `${serverEnv.APP_ORIGIN}/reset-password?token=${token}&token=${token}`,
      ),
    );

    for (const result of [malformedResult, repeatedResult]) {
      expect(result.redirectTo).toBe('/reset-password?state=invalid');
      expect(result.redirectTo).not.toContain(token);
      expect(result.headers.get('set-cookie')).toContain('Max-Age=0');
      expect(result.headers.get('cache-control')).toContain('no-store');
      expect(result.headers.get('referrer-policy')).toBe('no-referrer');
      expect(JSON.stringify(result.data)).not.toContain(token);
    }

    expect(malformedResult.redirectTo).not.toContain(malformed);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears a malformed staging cookie and reports invalid state', () => {
    const result = loadPasswordResetPage(
      new Request(`${serverEnv.APP_ORIGIN}/reset-password`, {
        headers: { cookie: `${cookieName}=malformed` },
      }),
    );

    expect(result.data.state).toBe('invalid');
    expect(result.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(JSON.stringify(result.data)).not.toContain('malformed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports missing state when no token is staged', () => {
    const result = loadPasswordResetPage(
      new Request(`${serverEnv.APP_ORIGIN}/reset-password`),
    );

    expect(result.data.state).toBe('missing');
    expect(result.data.csrfToken).toMatch(/^\d{10}\./);
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(result.headers.get('referrer-policy')).toBe('no-referrer');
    expect(fetch).not.toHaveBeenCalled();
  });
});
