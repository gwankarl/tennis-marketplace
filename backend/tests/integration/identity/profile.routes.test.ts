import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../../src/app.js';
import type { SessionService } from '../../../src/modules/identity/sessions/session.service.js';
import type { UserProfileService } from '../../../src/modules/identity/accounts/profile.service.js';

const CREDENTIAL = 'A'.repeat(43);
const USER_ID = '00000000-0000-4000-8000-000000000001';

const SESSION = {
  sessionId: '00000000-0000-4000-8000-000000000002',
  userId: USER_ID,
  email: 'player@example.test',
  firstName: 'Test',
  lastName: 'Player',
  isAdministrator: false,
};

const PROFILE = {
  firstName: 'Test',
  lastName: 'Player',
  email: 'player@example.test',
  emailVerified: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function makeApp(session: typeof SESSION | null = SESSION) {
  const service: UserProfileService = {
    get: vi.fn(async () => PROFILE),
    update: vi.fn(async () => ({ ...PROFILE, firstName: 'Serena' })),
  };
  const sessions = {
    current: vi.fn(async () => session),
  } as unknown as Pick<SessionService, 'current'>;

  return {
    app: buildApp({ userProfile: { service, sessions } }),
    service,
    sessions,
  };
}

describe('GET and PATCH /api/v1/users/me', () => {
  it('returns only the safe profile projection and disables caching', async () => {
    const { app, service } = makeApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me',
        headers: { authorization: `Bearer ${CREDENTIAL}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({
        data: {
          profile: {
            firstName: 'Test',
            lastName: 'Player',
            email: 'player@example.test',
            emailVerified: true,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
      });
      expect(response.body).not.toContain('passwordHash');
      expect(service.get).toHaveBeenCalledWith(USER_ID);
    } finally {
      await app.close();
    }
  });

  it('updates only supplied names for the authenticated session user', async () => {
    const { app, service } = makeApp();

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/users/me',
        headers: { authorization: `Bearer ${CREDENTIAL}` },
        payload: { firstName: ' Serena ' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json().data.profile.firstName).toBe('Serena');
      expect(service.update).toHaveBeenCalledWith(USER_ID, {
        firstName: 'Serena',
      });
    } finally {
      await app.close();
    }
  });

  it('rejects requests without a valid session before profile access', async () => {
    const { app, service } = makeApp(null);

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/users/me',
        headers: { authorization: `Bearer ${CREDENTIAL}` },
        payload: { firstName: 'Updated' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHENTICATED');
      expect(service.update).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    'email',
    'password',
    'permissions',
    'status',
    'emailVerified',
    'userId',
  ])('rejects a PATCH containing protected field %s', async (field) => {
    const { app, service } = makeApp();
    const payload = {
      firstName: 'Updated',
      [field]: 'forbidden',
    };

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/users/me',
        headers: { authorization: `Bearer ${CREDENTIAL}` },
        payload,
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
      expect(service.update).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects an empty PATCH', async () => {
    const { app, service } = makeApp();

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/users/me',
        headers: { authorization: `Bearer ${CREDENTIAL}` },
        payload: {},
      });

      expect(response.statusCode).toBe(422);
      expect(service.update).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
