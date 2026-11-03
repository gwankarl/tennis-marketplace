import { describe, expect, it } from 'vitest';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import {
  registrationAcknowledgementSchema,
  registrationRequestSchema,
  type RegistrationAcknowledgement,
} from '../../../src/modules/identity/registration/registration.schema.js';
import { buildApp } from '../../../src/app.js';

const validRequest = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'Ada.Lovelace+tennis@example.test',
  password: '  Correct Horse Battery Staple  ',
  termsAccepted: true,
};

const acknowledgement: RegistrationAcknowledgement = {
  data: { message: 'Registration request received.' },
};

function createTestApp() {
  const app = buildApp();

  app.register(async function registerTestRoutes(testRoutes) {
    const typedRoutes = testRoutes.withTypeProvider<ZodTypeProvider>();

    typedRoutes.post(
      '/__test/registration',
      {
        schema: {
          body: registrationRequestSchema,
          response: {
            200: registrationAcknowledgementSchema,
          },
        },
      },
      async () => acknowledgement,
    );

    typedRoutes.post(
      '/__test/invalid-registration-response',
      {
        schema: {
          response: {
            200: registrationAcknowledgementSchema,
          },
        },
      },
      async () =>
        ({
          data: { message: 'Internal response detail.' },
        }) as unknown as RegistrationAcknowledgement,
    );
  });

  return app;
}

describe('registration schemas', () => {
  it('trims names and email, lowercases email, and preserves dots and plus tags', () => {
    const result = registrationRequestSchema.parse({
      ...validRequest,
      firstName: '  Ada  ',
      lastName: '  O’Lovelace-Smith  ',
      email: '  Ada.Lovelace+Tennis@Example.Test  ',
    });

    expect(result).toMatchObject({
      firstName: 'Ada',
      lastName: 'O’Lovelace-Smith',
      email: 'ada.lovelace+tennis@example.test',
      password: validRequest.password,
      termsAccepted: true,
    });
  });

  it('accepts names at 100 Unicode code points and rejects 101', () => {
    const supplementaryLetter = String.fromCodePoint(0x10400);
    const nameAtLimit = supplementaryLetter.repeat(100);
    const nameOverLimit = supplementaryLetter.repeat(101);

    expect(
      registrationRequestSchema.safeParse({
        ...validRequest,
        firstName: nameAtLimit,
      }).success,
    ).toBe(true);

    expect(
      registrationRequestSchema.safeParse({
        ...validRequest,
        firstName: nameOverLimit,
      }).success,
    ).toBe(false);
  });

  it('accepts Unicode names with spaces, apostrophes, and hyphens', () => {
    const result = registrationRequestSchema.safeParse({
      ...validRequest,
      firstName: '  Zoë  ',
      lastName: '  D’Arcy-Smith  ',
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.firstName).toBe('Zoë');
      expect(result.data.lastName).toBe('D’Arcy-Smith');
    }
  });

  it('rejects blank names and names containing control characters', () => {
    for (const firstName of ['   ', 'Ada\nLovelace']) {
      expect(
        registrationRequestSchema.safeParse({
          ...validRequest,
          firstName,
        }).success,
      ).toBe(false);
    }
  });

  it('accepts email at 254 characters and rejects 255 characters', () => {
    const domain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
    const emailAtLimit = `${'a'.repeat(64)}@${domain}`;
    const emailOverLimit = `${'a'.repeat(65)}@${domain}`;

    expect(emailAtLimit).toHaveLength(254);
    expect(emailOverLimit).toHaveLength(255);

    expect(
      registrationRequestSchema.safeParse({
        ...validRequest,
        email: emailAtLimit,
      }).success,
    ).toBe(true);

    expect(
      registrationRequestSchema.safeParse({
        ...validRequest,
        email: emailOverLimit,
      }).success,
    ).toBe(false);
  });

  it('preserves passwords exactly and counts Unicode code points', () => {
    const password = `  ${'a'.repeat(15)}  `;
    const supplementaryLetter = String.fromCodePoint(0x10400);
    const passwordAtMaximum = supplementaryLetter.repeat(128);
    const passwordOverMaximum = supplementaryLetter.repeat(129);

    const parsed = registrationRequestSchema.parse({
      ...validRequest,
      password,
    });

    expect(parsed.password).toBe(password);

    expect(
      registrationRequestSchema.safeParse({
        ...validRequest,
        password: 'a'.repeat(14),
      }).success,
    ).toBe(false);

    expect(
      registrationRequestSchema.safeParse({
        ...validRequest,
        password: passwordAtMaximum,
      }).success,
    ).toBe(true);

    expect(
      registrationRequestSchema.safeParse({
        ...validRequest,
        password: passwordOverMaximum,
      }).success,
    ).toBe(false);
  });

  it.each([
    ['role', 'administrator'],
    ['status', 'active'],
    ['emailVerifiedAt', '2026-01-01T00:00:00.000Z'],
    ['termsAcceptedAt', '2026-01-01T00:00:00.000Z'],
    ['termsAcceptedVersion', 'terms-v1'],
    ['confirmPassword', validRequest.password],
  ])('rejects the unexpected field %s', (field, value) => {
    expect(
      registrationRequestSchema.safeParse({
        ...validRequest,
        [field]: value,
      }).success,
    ).toBe(false);
  });

  it('requires explicit Terms acceptance', () => {
    const { termsAccepted: _termsAccepted, ...withoutTerms } = validRequest;

    expect(registrationRequestSchema.safeParse(withoutTerms).success).toBe(
      false,
    );

    expect(
      registrationRequestSchema.safeParse({
        ...validRequest,
        termsAccepted: false,
      }).success,
    ).toBe(false);
  });

  it('defines a generic acknowledgement without account or session data', () => {
    expect(registrationAcknowledgementSchema.parse(acknowledgement)).toEqual(
      acknowledgement,
    );

    expect(
      registrationAcknowledgementSchema.safeParse({
        ...acknowledgement,
        accountId: 'account-id',
      }).success,
    ).toBe(false);
  });
});

describe('Fastify registration schema integration', () => {
  it('validates requests and returns the declared generic acknowledgement', async () => {
    const app = createTestApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/__test/registration',
        payload: validRequest,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(acknowledgement);
    } finally {
      await app.close();
    }
  });

  it('returns a safe 422 envelope for request validation failures', async () => {
    const app = createTestApp();
    const secretMarker = 'submitted-password-secret-marker';

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/__test/registration',
        payload: {
          ...validRequest,
          password: secretMarker,
          termsAccepted: false,
        },
      });

      const requestId = response.headers['x-request-id'];
      const body = response.json();

      expect(response.statusCode).toBe(422);
      expect(body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request contains invalid fields.',
          details: expect.arrayContaining([
            expect.objectContaining({
              field: 'termsAccepted',
              code: 'FIELD_INVALID',
              message: 'This field is invalid.',
            }),
          ]),
        },
        meta: { requestId },
      });
      expect(response.body).not.toContain(secretMarker);
      expect(response.headers['x-request-id']).toBe(requestId);
    } finally {
      await app.close();
    }
  });

  it('rejects unexpected fields through actual Fastify request validation', async () => {
    const app = createTestApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/__test/registration',
        payload: {
          ...validRequest,
          role: 'administrator',
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
      expect(response.body).not.toContain('administrator');
    } finally {
      await app.close();
    }
  });

  it('maps invalid server responses to a safe internal error', async () => {
    const app = createTestApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/__test/invalid-registration-response',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      });
      expect(response.body).not.toContain('Internal response detail.');
    } finally {
      await app.close();
    }
  });

  it('generates OpenAPI from the test route schemas', async () => {
    const app = createTestApp();

    try {
      await app.ready();

      const document = app.swagger();

      const operation = document.paths?.['/__test/registration']?.post;

      expect(operation).toBeDefined();

      if (operation) {
        expect(operation).toHaveProperty('requestBody');
        expect(operation).toHaveProperty('responses.200');
      }
    } finally {
      await app.close();
    }
  });
});
