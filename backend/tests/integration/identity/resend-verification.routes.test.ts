import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../../src/app.js';
import type { ResendVerificationService } from '../../../src/modules/identity/verification/resend-verification.service.js';

const acknowledgement = {
  data: {
    message: 'If an account needs verification, instructions may be sent.',
  },
} as const;

function createTestApp(
  resend: ResendVerificationService['resend'] = vi.fn(
    async () => acknowledgement,
  ),
) {
  const app = buildApp({
    resendVerification: {
      service: { resend },
      ipRateLimitMax: 5,
      ipRateLimitWindowMs: 60 * 60 * 1000,
    },
  });

  return { app, resend };
}

describe('POST /api/v1/auth/resend-verification', () => {
  it('normalizes the email and returns the generic acknowledgement', async () => {
    const resend = vi.fn<ResendVerificationService['resend']>(
      async () => acknowledgement,
    );
    const { app } = createTestApp(resend);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/resend-verification',
        payload: { email: '  Player+Tennis@Example.test  ' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(acknowledgement);
      expect(resend).toHaveBeenCalledWith({
        email: 'player+tennis@example.test',
      });
    } finally {
      await app.close();
    }
  });

  it('rejects malformed emails and unexpected fields before calling the service', async () => {
    const resend = vi.fn<ResendVerificationService['resend']>(
      async () => acknowledgement,
    );
    const { app } = createTestApp(resend);

    try {
      const malformed = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/resend-verification',
        payload: { email: 'not-an-email' },
      });
      const unexpected = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/resend-verification',
        payload: {
          email: 'player@example.test',
          accountId: 'client-controlled',
        },
      });

      for (const response of [malformed, unexpected]) {
        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe('VALIDATION_ERROR');
      }

      expect(resend).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('counts invalid submissions against the socket IP despite spoofed forwarding headers', async () => {
    const resend = vi.fn<ResendVerificationService['resend']>(
      async () => acknowledgement,
    );
    const { app } = createTestApp(resend);

    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/resend-verification',
          headers: {
            'x-forwarded-for': `198.51.100.${attempt + 1}`,
          },
          payload: { email: 'invalid' },
        });

        expect(response.statusCode).toBe(422);
      }

      const limited = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/resend-verification',
        headers: { 'x-forwarded-for': '203.0.113.99' },
        payload: { email: 'player@example.test' },
      });

      expect(limited.statusCode).toBe(429);
      expect(limited.json().error.code).toBe('RATE_LIMITED');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(resend).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('documents the request and response contracts in OpenAPI', async () => {
    const { app } = createTestApp();

    try {
      await app.ready();

      const operation =
        app.swagger().paths?.['/api/v1/auth/resend-verification']?.post;

      expect(operation).toBeDefined();
      expect(operation).toHaveProperty('requestBody');
      expect(operation).toHaveProperty('responses.200');
      expect(operation).toHaveProperty('responses.422');
      expect(operation).toHaveProperty('responses.429');
    } finally {
      await app.close();
    }
  });
});
