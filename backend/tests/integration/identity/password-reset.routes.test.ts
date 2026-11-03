import { describe, expect, it, vi } from 'vitest';
import { ApplicationError } from '../../../src/http/application-error.js';
import type { PasswordResetService } from '../../../src/modules/identity/passwords/password-reset.service.js';
import type { PasswordResetRequestService } from '../../../src/modules/identity/passwords/password-reset-request.service.js';
import { buildApp } from '../../../src/app.js';

const acknowledgement = {
  data: {
    message:
      'If an account is eligible for a password reset, instructions may be sent.',
  },
} as const;

const validPassword = 'a replacement password long enough';

function makeApp(options: { ipLimit?: number } = {}) {
  const requestReset = vi.fn<PasswordResetRequestService['requestReset']>(
    async () => acknowledgement,
  );
  const reset = vi.fn<PasswordResetService['reset']>(async () => undefined);

  const app = buildApp({
    passwordReset: {
      requests: { requestReset },
      reset: { reset },
      ipRateLimitMax: options.ipLimit ?? 5,
      ipRateLimitWindowMs: 60 * 60 * 1000,
    },
  });

  return { app, requestReset, reset };
}

describe('password reset routes', () => {
  it('returns a generic no-store acknowledgement without echoing the email', async () => {
    const { app, requestReset } = makeApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/request-password-reset',
        payload: { email: 'player@example.test' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(acknowledgement);
      expect(response.body).not.toContain('player@example.test');
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
      expect(requestReset).toHaveBeenCalledWith({
        email: 'player@example.test',
      });
    } finally {
      await app.close();
    }
  });

  it('rejects malformed and unexpected request fields before calling the service', async () => {
    const { app, requestReset } = makeApp();

    try {
      const malformed = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/request-password-reset',
        payload: { email: 'not-an-email' },
      });
      const unexpected = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/request-password-reset',
        payload: { email: 'player@example.test', userId: 'client-value' },
      });

      expect(malformed.statusCode).toBe(422);
      expect(unexpected.statusCode).toBe(422);
      expect(malformed.json().error.code).toBe('VALIDATION_ERROR');
      expect(unexpected.json().error.code).toBe('VALIDATION_ERROR');
      expect(requestReset).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('counts invalid requests against the socket-IP limit and ignores forwarded-header spoofing', async () => {
    const { app, requestReset } = makeApp({ ipLimit: 1 });

    try {
      const invalid = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/request-password-reset',
        headers: { 'x-forwarded-for': '198.51.100.10' },
        payload: { email: 'invalid' },
      });
      const limited = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/request-password-reset',
        headers: { 'x-forwarded-for': '203.0.113.20' },
        payload: { email: 'player@example.test' },
      });

      expect(invalid.statusCode).toBe(422);
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error.code).toBe('RATE_LIMITED');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(limited.headers['cache-control']).toContain('no-store');
      expect(requestReset).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns only a safe confirmation acknowledgement and no-store headers', async () => {
    const { app, reset } = makeApp();

    try {
      const token = 'A'.repeat(43);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/confirm-password-reset',
        payload: { token, password: validPassword },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        data: { message: 'Password reset complete.' },
      });
      expect(response.body).not.toContain(token);
      expect(response.body).not.toContain(validPassword);
      expect(response.headers['cache-control']).toContain('no-store');
      expect(reset).toHaveBeenCalledWith({
        token,
        password: validPassword,
      });
    } finally {
      await app.close();
    }
  });

  it('keeps invalid-token responses generic and never echoes submitted credentials', async () => {
    const token = 'B'.repeat(43);
    const reset = vi.fn<PasswordResetService['reset']>(async () => {
      throw new ApplicationError(
        'NOT_FOUND',
        'This password reset link is invalid or expired.',
      );
    });
    const app = buildApp({
      passwordReset: {
        requests: {
          requestReset: vi.fn(async () => acknowledgement),
        },
        reset: { reset },
        ipRateLimitMax: 5,
        ipRateLimitWindowMs: 60 * 60 * 1000,
      },
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/confirm-password-reset',
        payload: { token, password: validPassword },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toEqual({
        code: 'NOT_FOUND',
        message: 'This password reset link is invalid or expired.',
      });
      expect(response.body).not.toContain(token);
      expect(response.body).not.toContain(validPassword);
      expect(response.headers['cache-control']).toContain('no-store');
    } finally {
      await app.close();
    }
  });
});
