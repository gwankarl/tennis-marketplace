import { describe, expect, it } from 'vitest';
import { parseBackendEnv } from '../src/config/env.js';

describe('parseBackendEnv', () => {
  it('parses valid configuration and converts PORT to a number', () => {
    expect(
      parseBackendEnv({
        DATABASE_URL:
          'postgresql://dev:example@127.0.0.1:5432/tennis_xpress_dev',
        HOST: '127.0.0.1',
        PORT: '3100',
        LOGIN_RATE_LIMIT_HMAC_KEY: 'A'.repeat(43),
        TERMS_VERSION: 'terms-v1',
      }),
    ).toEqual({
      DATABASE_URL: 'postgresql://dev:example@127.0.0.1:5432/tennis_xpress_dev',
      HOST: '127.0.0.1',
      PORT: 3100,
      LOGIN_RATE_LIMIT_HMAC_KEY: 'A'.repeat(43),
      LOGIN_RATE_LIMIT_IP_MAX: 20,
      LOGIN_RATE_LIMIT_EMAIL_MAX: 10,
      LOGIN_RATE_LIMIT_WINDOW_MS: 900_000,
      REGISTRATION_RATE_LIMIT_MAX: 5,
      REGISTRATION_RATE_LIMIT_WINDOW_MS: 900_000,
      RESEND_VERIFICATION_IP_RATE_LIMIT_MAX: 5,
      RESEND_VERIFICATION_IP_RATE_LIMIT_WINDOW_MS: 3_600_000,
      RESEND_VERIFICATION_ACCOUNT_MAX_PER_HOUR: 5,
      RESEND_VERIFICATION_ACCOUNT_COOLDOWN_MS: 60_000,
      TERMS_VERSION: 'terms-v1',
    });
  });

  it('reports missing required configuration without values', () => {
    let errorMessage = '';

    try {
      parseBackendEnv({});
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain('DATABASE_URL');
    expect(errorMessage).not.toContain('postgresql://');
  });

  it('rejects invalid database URLs without exposing their contents', () => {
    const secretMarker = 'do-not-print-this-value';
    let errorMessage = '';

    try {
      parseBackendEnv({
        DATABASE_URL: `mysql://user:${secretMarker}@example.test/database`,
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain('DATABASE_URL');
    expect(errorMessage).not.toContain(secretMarker);
  });

  it('rejects invalid ports', () => {
    let errorMessage = '';

    try {
      parseBackendEnv({
        DATABASE_URL:
          'postgresql://dev:example@127.0.0.1:5432/tennis_xpress_dev',
        PORT: 'not-a-port',
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain('PORT');
  });

  it('rejects an invalid login HMAC key without exposing its value', () => {
    const secretMarker = 'not-a-valid-login-hmac-key';
    let errorMessage = '';

    try {
      parseBackendEnv({
        DATABASE_URL:
          'postgresql://dev:example@127.0.0.1:5432/tennis_xpress_dev',
        TERMS_VERSION: 'terms-v1',
        LOGIN_RATE_LIMIT_HMAC_KEY: secretMarker,
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain('LOGIN_RATE_LIMIT_HMAC_KEY');
    expect(errorMessage).not.toContain(secretMarker);
  });
});
