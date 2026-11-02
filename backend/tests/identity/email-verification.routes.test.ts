import { describe, expect, it, vi } from 'vitest';
import type { EmailVerificationService } from '../../src/identity/email-verification.service.js';
import { ApplicationError } from '../../src/http/application-error.js';
import { buildApp } from '../../src/app.js';

const validToken = 'A'.repeat(43);
const acknowledgement = {
  data: { message: 'Email address verified.' },
} as const;

function createTestApp(
  consume: EmailVerificationService['consume'] = vi.fn(async () => undefined),
  loggerStream?: { write(message: string): void },
) {
  return buildApp({
    loggerStream,
    emailVerification: {
      service: { consume },
    },
  });
}

describe('POST /api/v1/auth/verify-email', () => {
  it('consumes a valid token and returns only the minimal acknowledgement', async () => {
    const consume = vi.fn<EmailVerificationService['consume']>(
      async () => undefined,
    );
    const logLines: string[] = [];
    const app = createTestApp(consume, {
      write(message) {
        logLines.push(message);
      },
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-email',
        payload: { token: validToken },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(acknowledgement);
      expect(response.body).not.toContain(validToken);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(consume).toHaveBeenCalledOnce();
      expect(consume).toHaveBeenCalledWith(validToken);

      await app.close();
      expect(logLines.join('')).not.toContain(validToken);
    } finally {
      await app.close();
    }
  });

  it('returns 422 for malformed tokens and unexpected fields without calling the service', async () => {
    const consume = vi.fn<EmailVerificationService['consume']>(
      async () => undefined,
    );
    const app = createTestApp(consume);

    try {
      const malformed = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-email',
        payload: { token: 'too-short' },
      });
      const unexpectedField = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-email',
        payload: { token: validToken, accountId: 'client-assigned-value' },
      });

      for (const response of [malformed, unexpectedField]) {
        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe('VALIDATION_ERROR');
        expect(response.body).not.toContain(validToken);
        expect(response.headers['x-request-id']).toBe(
          response.json().meta.requestId,
        );
      }

      expect(consume).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each(['invalid', 'expired', 'already consumed'])(
    'returns the same safe 404 for a token that is %s',
    async () => {
      const consume = vi.fn<EmailVerificationService['consume']>(async () => {
        throw new ApplicationError(
          'NOT_FOUND',
          'This verification link is invalid or expired.',
        );
      });
      const app = createTestApp(consume);

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/verify-email',
          payload: { token: validToken },
        });

        expect(response.statusCode).toBe(404);
        expect(response.json().error).toEqual({
          code: 'NOT_FOUND',
          message: 'This verification link is invalid or expired.',
        });
        expect(response.body).not.toContain(validToken);
      } finally {
        await app.close();
      }
    },
  );

  it('returns a safe 500 if token consumption fails unexpectedly', async () => {
    const consume = vi.fn<EmailVerificationService['consume']>(async () => {
      throw new Error(`private failure ${validToken}`);
    });
    const app = createTestApp(consume);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-email',
        payload: { token: validToken },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      });
      expect(response.body).not.toContain(validToken);
    } finally {
      await app.close();
    }
  });

  it('does not consume a token through GET', async () => {
    const consume = vi.fn<EmailVerificationService['consume']>(
      async () => undefined,
    );
    const app = createTestApp(consume);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/verify-email',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
      expect(consume).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('documents the request, acknowledgement, and error responses without token examples', async () => {
    const app = createTestApp();

    try {
      await app.ready();

      const document = app.swagger();
      const operation = document.paths?.['/api/v1/auth/verify-email']?.post;

      expect(operation).toBeDefined();
      expect(operation).toHaveProperty('requestBody');
      expect(operation).toHaveProperty('responses.200');
      expect(operation).toHaveProperty('responses.404');
      expect(operation).toHaveProperty('responses.422');
      expect(operation).toHaveProperty('responses.500');
      expect(JSON.stringify(operation)).not.toContain(validToken);
    } finally {
      await app.close();
    }
  });
});
