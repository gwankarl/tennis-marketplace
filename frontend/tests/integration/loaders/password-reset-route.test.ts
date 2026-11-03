import { describe, expect, it } from 'vitest';
import { serverEnv } from '../../../app/config/server-env.server';
import {
  headers as passwordResetRouteHeaders,
  loader as passwordResetLoader,
} from '../../../app/routes/reset-password';

const token = 'B'.repeat(43);

describe('password reset route headers', () => {
  it('keeps the token-bearing redirect clean and private', async () => {
    const response = await passwordResetLoader({
      request: new Request(
        `${serverEnv.APP_ORIGIN}/reset-password?token=${token}`,
      ),
    });

    if (!(response instanceof Response)) {
      throw new Error('Expected the token-bearing loader to redirect.');
    }

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/reset-password');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('set-cookie')).toContain(
      `tx_password_reset_stage=${token}`,
    );
  });

  it('preserves reset and session cookie clearing while enforcing private headers', () => {
    const loaderHeaders = new Headers();
    loaderHeaders.append(
      'Set-Cookie',
      'tx_password_reset_stage=; Path=/reset-password; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    );

    const actionHeaders = new Headers();
    actionHeaders.append(
      'Set-Cookie',
      'tx_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    );

    const result = passwordResetRouteHeaders({
      loaderHeaders,
      actionHeaders,
    });
    const setCookie = result.get('set-cookie') ?? '';

    expect(setCookie).toContain('tx_password_reset_stage=');
    expect(setCookie).toContain('tx_session=');
    expect(result.get('cache-control')).toContain('no-store');
    expect(result.get('referrer-policy')).toBe('no-referrer');
  });
});
