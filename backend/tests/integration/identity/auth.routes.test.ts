import { describe, expect, it, vi } from 'vitest';
import type {
  WorkspaceAccessRepository,
  WorkspaceKey,
} from '../../../src/modules/identity/accounts/workspace-access.repository.js';
import { buildApp } from '../../../src/app.js';
import type { LoginService } from '../../../src/modules/identity/sessions/login.service.js';
import type { SessionService } from '../../../src/modules/identity/sessions/session.service.js';

const credential = 'A'.repeat(43);
const identity = {
  sessionId: '00000000-0000-4000-8000-000000000002',
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'player@example.test',
  firstName: 'Test',
  lastName: 'Player',
  isAdministrator: false,
};

function makeApp(
  loginResult: Awaited<ReturnType<LoginService['login']>> = {
    kind: 'authenticated',
    credential,
    absoluteExpiresAt: new Date('2026-02-01T12:00:00.000Z'),
    user: {
      id: identity.userId,
      firstName: identity.firstName,
      lastName: identity.lastName,
      isAdministrator: false,
    },
  },
  permittedWorkspaces: WorkspaceKey[] | null = ['buyer'],
) {
  const login = {
    login: vi.fn(async () => loginResult),
  } as unknown as LoginService;
  const sessions = {
    current: vi.fn(async () => identity),
    logout: vi.fn(async () => true),
  } as unknown as SessionService;
  const workspaces = {
    forActiveUser: vi.fn(async () => permittedWorkspaces),
  } as unknown as WorkspaceAccessRepository;

  return {
    app: buildApp({
      authentication: { login, sessions, workspaces },
    }),
    login,
    sessions,
    workspaces,
  };
}

describe('authentication routes', () => {
  it('returns the server-to-server credential with no-store headers', async () => {
    const { app, login } = makeApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: ' PLAYER@Example.Test ',
          password: '  existing password exactly  ',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.pragma).toBe('no-cache');
      expect(response.json().data.credential).toBe(credential);
      expect(response.json().data.absoluteExpiresAt).toBe(
        '2026-02-01T12:00:00.000Z',
      );
      expect(login.login).toHaveBeenCalledWith(
        {
          email: 'player@example.test',
          password: '  existing password exactly  ',
        },
        '127.0.0.1',
      );
      expect(response.headers['set-cookie']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('maps malformed and extra login fields to 422 without calling login', async () => {
    const { app, login } = makeApp();

    try {
      const malformed = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'player@example.test', password: 'x'.repeat(1025) },
      });
      const extra = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'player@example.test',
          password: 'unchanged',
          role: 'administrator',
        },
      });

      for (const response of [malformed, extra]) {
        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe('VALIDATION_ERROR');
        expect(response.headers['cache-control']).toBe('no-store');
      }

      expect(login.login).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns the same generic 401 for unknown email and incorrect password', async () => {
    for (const responseOutcome of [
      { kind: 'invalid_credentials' as const },
      { kind: 'invalid_credentials' as const },
    ]) {
      const { app } = makeApp(responseOutcome);

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 'player@example.test', password: 'wrong' },
        });

        expect(response.statusCode).toBe(401);
        expect(response.json().error).toEqual({
          code: 'UNAUTHENTICATED',
          message: 'Email or password is incorrect.',
        });
      } finally {
        await app.close();
      }
    }
  });

  it.each([
    ['email_verification_required', 'EMAIL_VERIFICATION_REQUIRED'],
    ['account_restricted', 'ACCOUNT_RESTRICTED'],
  ] as const)(
    'maps %s after successful password verification',
    async (kind, code) => {
      const { app } = makeApp({ kind });

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 'player@example.test', password: 'correct' },
        });

        expect(response.statusCode).toBe(403);
        expect(response.json().error.code).toBe(code);
        expect(response.headers['cache-control']).toBe('no-store');
      } finally {
        await app.close();
      }
    },
  );

  it('returns 429 with Retry-After without exposing which counter limited login', async () => {
    const { app } = makeApp({ kind: 'rate_limited', retryAfterSeconds: 31 });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'player@example.test', password: 'unchanged' },
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBe('31');
      expect(response.json().error).toEqual({
        code: 'RATE_LIMITED',
        message: 'Too many login attempts. Try again later.',
      });
    } finally {
      await app.close();
    }
  });

  it('authenticates current identity from Authorization and ignores forwarded IP headers', async () => {
    const { app, sessions, workspaces } = makeApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: {
          authorization: `Bearer ${credential}`,
          'x-forwarded-for': '203.0.113.40',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.user.id).toBe(identity.userId);
      expect(response.json().data.user.workspaces).toEqual(['buyer']);
      expect(sessions.current).toHaveBeenCalledWith(credential);
      expect(workspaces.forActiveUser).toHaveBeenCalledWith(identity.userId);
      expect(response.body).not.toContain(credential);
    } finally {
      await app.close();
    }
  });

  it('returns only the workspaces granted by the repository', async () => {
    const { app } = makeApp(undefined, ['buyer', 'seller']);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { authorization: `Bearer ${credential}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json().data.user.workspaces).toEqual(['buyer', 'seller']);
      expect(response.body).not.toContain(credential);
    } finally {
      await app.close();
    }
  });

  it('rejects a current identity when the account is no longer eligible', async () => {
    const { app } = makeApp(undefined, null);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { authorization: `Bearer ${credential}` },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHENTICATED');
    } finally {
      await app.close();
    }
  });

  it('returns 401 for missing or invalid current-session credentials', async () => {
    const { app, sessions } = makeApp();

    try {
      const missing = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
      });
      const invalid = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { authorization: 'Bearer malformed' },
      });

      expect(missing.statusCode).toBe(401);
      expect(invalid.statusCode).toBe(401);
      expect(sessions.current).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('makes logout idempotent and never returns the credential', async () => {
    const { app, sessions } = makeApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { authorization: `Bearer ${credential}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: { message: 'Logged out.' } });
      expect(sessions.logout).toHaveBeenCalledWith(credential);
      expect(response.body).not.toContain(credential);
    } finally {
      await app.close();
    }
  });

  it('documents all auth operations without credential examples', async () => {
    const { app } = makeApp();

    try {
      await app.ready();
      const document = app.swagger();
      const login = document.paths?.['/api/v1/auth/login']?.post;
      const current = document.paths?.['/api/v1/auth/session']?.get;
      const logout = document.paths?.['/api/v1/auth/logout']?.post;

      expect(login).toHaveProperty('requestBody');
      expect(login).toHaveProperty('responses.200');
      expect(login).toHaveProperty('responses.401');
      expect(login).toHaveProperty('responses.429');
      expect(current).toHaveProperty('security');
      expect(logout).toHaveProperty('security');
      expect(JSON.stringify(document)).not.toContain(credential);
    } finally {
      await app.close();
    }
  });

  it('keeps unexpected login failures safe', async () => {
    const { app, login } = makeApp();
    vi.mocked(login.login).mockRejectedValueOnce(
      new Error(`private password and ${credential}`),
    );

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'player@example.test',
          password: 'private submitted password',
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('private password');
      expect(response.body).not.toContain(credential);
      expect(response.body).not.toContain('private submitted password');
    } finally {
      await app.close();
    }
  });
});
