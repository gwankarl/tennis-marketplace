import { describe, expect, it, vi } from 'vitest';
import type { RegistrationService } from '../../../src/modules/identity/registration/registration.service.js';
import type { RegistrationRequest } from '../../../src/modules/identity/registration/registration.schema.js';
import { ApplicationError } from '../../../src/http/application-error.js';
import { buildApp } from '../../../src/app.js';

const acknowledgement = {
  data: { message: 'Registration request received.' },
} as const;

const validRequest: RegistrationRequest = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada.lovelace+tennis@example.test',
  password: '  Correct Horse Battery Staple  ',
  termsAccepted: true,
};

function createTestApp(
  register: RegistrationService['register'] = vi.fn(
    async () => acknowledgement,
  ),
) {
  const app = buildApp({
    registration: {
      service: { register },
      rateLimitMax: 5,
      rateLimitWindowMs: 900_000,
    },
  });

  return { app, register };
}

async function withTestApp<T>(
  run: (
    app: ReturnType<typeof buildApp>,
    register: RegistrationService['register'],
  ) => Promise<T>,
): Promise<T> {
  const { app, register } = createTestApp();

  try {
    return await run(app, register);
  } finally {
    await app.close();
  }
}

describe('POST /api/v1/auth/register', () => {
  it('returns the same generic 200 acknowledgement on repeated submissions', async () => {
    await withTestApp(async (app, register) => {
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: validRequest,
      });
      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: validRequest,
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(first.json()).toEqual(acknowledgement);
      expect(second.json()).toEqual(first.json());
      expect(first.headers['set-cookie']).toBeUndefined();
      expect(second.headers['set-cookie']).toBeUndefined();
      expect(register).toHaveBeenCalledTimes(2);
    });
  });

  it('rejects invalid and privileged fields before calling the service', async () => {
    await withTestApp(async (app, register) => {
      const missingTerms = { ...validRequest } as Record<string, unknown>;
      delete missingTerms.termsAccepted;

      const invalid = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: missingTerms,
      });
      const privileged = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { ...validRequest, role: 'administrator' },
      });

      expect(invalid.statusCode).toBe(422);
      expect(privileged.statusCode).toBe(422);
      expect(invalid.json().error.code).toBe('VALIDATION_ERROR');
      expect(privileged.json().error.code).toBe('VALIDATION_ERROR');
      expect(register).not.toHaveBeenCalled();
    });
  });

  it('returns the established password field error for compromised passwords', async () => {
    const register = vi.fn<RegistrationService['register']>(async () => {
      throw new ApplicationError(
        'VALIDATION_ERROR',
        'Choose a password that has not appeared in known data breaches.',
        [
          {
            field: 'password',
            code: 'PASSWORD_COMPROMISED',
            message:
              'Choose a password that has not appeared in known data breaches.',
          },
        ],
      );
    });

    const { app } = createTestApp(register);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: validRequest,
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.details[0].field).toBe('password');
    } finally {
      await app.close();
    }
  });

  it('maps screening outages to 503 without exposing internal information', async () => {
    const register = vi.fn<RegistrationService['register']>(async () => {
      throw new ApplicationError(
        'SERVICE_UNAVAILABLE',
        'Password screening is temporarily unavailable.',
      );
    });

    const { app } = createTestApp(register);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: validRequest,
      });

      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('SERVICE_UNAVAILABLE');
      expect(response.body).not.toContain(validRequest.password);
    } finally {
      await app.close();
    }
  });

  it('returns a safe internal error for unexpected service failures', async () => {
    const register = vi.fn<RegistrationService['register']>(async () => {
      throw new Error('private database detail and password marker');
    });

    const { app } = createTestApp(register);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: validRequest,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      });
      expect(response.body).not.toContain('private database detail');
      expect(response.body).not.toContain(validRequest.password);
    } finally {
      await app.close();
    }
  });

  it('limits attempts and ignores spoofed forwarding headers', async () => {
    await withTestApp(async (app, register) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          headers: {
            'x-forwarded-for': `198.51.100.${attempt + 1}`,
          },
          payload: validRequest,
        });

        expect(response.statusCode).toBe(200);
      }

      const limited = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { 'x-forwarded-for': '203.0.113.250' },
        payload: validRequest,
      });

      expect(limited.statusCode).toBe(429);
      expect(limited.headers['retry-after']).toBeDefined();
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(limited.json().error.code).toBe('RATE_LIMITED');
      expect(register).toHaveBeenCalledTimes(5);
    });
  });

  it('counts invalid submissions and rejects before service work', async () => {
    await withTestApp(async (app, register) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: { ...validRequest, termsAccepted: false },
        });

        expect(response.statusCode).toBe(422);
      }

      const sixth = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: validRequest,
      });

      expect(sixth.statusCode).toBe(429);
      expect(sixth.headers['retry-after']).toBeDefined();
      expect(register).not.toHaveBeenCalled();
    });
  });

  it('documents the registration request, success, and error responses', async () => {
    await withTestApp(async (app) => {
      await app.ready();

      const document = app.swagger();
      const operation = document.paths?.['/api/v1/auth/register']?.post;

      expect(operation).toBeDefined();

      if (operation) {
        expect(operation).toHaveProperty('requestBody');
        expect(operation).toHaveProperty('responses.200');
        expect(operation).toHaveProperty('responses.422');
        expect(operation).toHaveProperty('responses.429');
        expect(operation).toHaveProperty('responses.503');
      }
    });
  });
});
