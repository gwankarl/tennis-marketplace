import { describe, expect, it, vi } from 'vitest';
import { createLoginService } from '../../src/identity/login.service.js';
import {
  createSessionService,
  type SessionService,
} from '../../src/identity/session.service.js';
import type {
  LoginAccountRecord,
  UserSessionRepository,
} from '../../src/identity/user-session.repository.js';
import type { LoginAttemptCounterRepository } from '../../src/identity/login-attempt-counter.repository.js';
import { hashSessionCredential } from '../../src/identity/session-credential.js';

const ACCOUNT: LoginAccountRecord = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'player@example.test',
  firstName: 'Test',
  lastName: 'Player',
  passwordHash: 'stored-hash',
  status: 'active',
  emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
  isAdministrator: false,
};

const NOW = new Date('2026-02-01T12:00:00.000Z');
const HMAC_KEY = Buffer.alloc(32, 11).toString('base64url');

function createLoginFixture(
  account: LoginAccountRecord | null = ACCOUNT,
  overrides: {
    lockedAccount?: LoginAccountRecord | null;
    passwordMatches?: boolean;
    allowed?: boolean;
  } = {},
) {
  const counters = {
    checkAndIncrement: vi.fn(async () =>
      overrides.allowed === false
        ? {
            allowed: false as const,
            scope: 'email' as const,
            retryAfterSeconds: 37,
          }
        : { allowed: true as const },
    ),
    deleteExpiredCounters: vi.fn(async () => 0),
  } satisfies LoginAttemptCounterRepository;

  const createSession = vi.fn(async () => undefined);
  const withLockedAccount = vi.fn(async (_id, operation) =>
    operation(
      overrides.lockedAccount === undefined ? account : overrides.lockedAccount,
      {} as never,
    ),
  );

  const sessions = {
    getLoginAccountByNormalizedEmail: vi.fn(async () => account),
    withLockedAccount,
    createSession,
  } as unknown as UserSessionRepository;

  const verifyPassword = vi.fn(
    async (hash: string, password: string) =>
      hash === 'stored-hash' && password === '  existing password exactly  ',
  );
  if (overrides.passwordMatches === false) {
    verifyPassword.mockResolvedValue(false);
  }

  const servicePromise = createLoginService({
    sessions,
    counters,
    passwords: {
      hashPassword: vi.fn(async () => 'dummy-argon2id-hash'),
      verifyPassword,
    },
    rateLimitHmacKey: HMAC_KEY,
    ipLimit: 20,
    emailLimit: 10,
    windowMs: 900_000,
    now: () => NOW,
    createCredential: () => 'A'.repeat(43),
  });

  return {
    servicePromise,
    counters,
    sessions,
    createSession,
    verifyPassword,
    withLockedAccount,
  };
}

describe('login service', () => {
  it('normalizes email but preserves the submitted password exactly', async () => {
    const fixture = createLoginFixture();
    const service = await fixture.servicePromise;

    const result = await service.login(
      {
        email: ' PLAYER@Example.Test ',
        password: '  existing password exactly  ',
      },
      '127.0.0.1',
    );

    expect(result.kind).toBe('authenticated');
    expect(
      fixture.sessions.getLoginAccountByNormalizedEmail,
    ).toHaveBeenCalledWith('player@example.test');
    expect(fixture.verifyPassword).toHaveBeenCalledWith(
      'stored-hash',
      '  existing password exactly  ',
    );
  });

  it.each([
    ['unknown email', null, undefined],
    ['incorrect password', ACCOUNT, false],
  ] as const)(
    'returns the same invalid-credentials outcome for %s',
    async (_caseName, account, passwordMatches) => {
      const fixture = createLoginFixture(account, { passwordMatches });
      const service = await fixture.servicePromise;

      const result = await service.login(
        { email: 'player@example.test', password: 'incorrect' },
        '127.0.0.1',
      );

      expect(result).toEqual({ kind: 'invalid_credentials' });
      expect(fixture.verifyPassword).toHaveBeenCalledOnce();
      expect(fixture.createSession).not.toHaveBeenCalled();
    },
  );

  it('checks counters before password verification and returns the limit delay', async () => {
    const fixture = createLoginFixture(ACCOUNT, { allowed: false });
    const service = await fixture.servicePromise;

    await expect(
      service.login(
        { email: 'player@example.test', password: 'unchanged' },
        '127.0.0.1',
      ),
    ).resolves.toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: 37,
    });

    expect(fixture.verifyPassword).not.toHaveBeenCalled();
    expect(
      fixture.sessions.getLoginAccountByNormalizedEmail,
    ).not.toHaveBeenCalled();
  });

  it('reveals unverified and restricted status only after password verification', async () => {
    const unverified = {
      ...ACCOUNT,
      emailVerifiedAt: null,
      status: 'pending_email_verification',
    };
    const unverifiedFixture = createLoginFixture(unverified);
    const unverifiedService = await unverifiedFixture.servicePromise;

    await expect(
      unverifiedService.login(
        { email: ACCOUNT.email, password: '  existing password exactly  ' },
        '127.0.0.1',
      ),
    ).resolves.toEqual({ kind: 'email_verification_required' });

    const suspendedFixture = createLoginFixture({
      ...ACCOUNT,
      status: 'suspended',
    });
    const suspendedService = await suspendedFixture.servicePromise;

    await expect(
      suspendedService.login(
        { email: ACCOUNT.email, password: '  existing password exactly  ' },
        '127.0.0.1',
      ),
    ).resolves.toEqual({ kind: 'account_restricted' });

    const wrongPasswordFixture = createLoginFixture(unverified, {
      passwordMatches: false,
    });
    const wrongPasswordService = await wrongPasswordFixture.servicePromise;

    await expect(
      wrongPasswordService.login(
        { email: ACCOUNT.email, password: 'wrong' },
        '127.0.0.1',
      ),
    ).resolves.toEqual({ kind: 'invalid_credentials' });
  });

  it('creates a hashed independent session and uses the administrator lifetime', async () => {
    const administrator = { ...ACCOUNT, isAdministrator: true };
    const fixture = createLoginFixture(administrator);
    const service = await fixture.servicePromise;

    const result = await service.login(
      { email: ACCOUNT.email, password: '  existing password exactly  ' },
      '127.0.0.1',
    );

    expect(result.kind).toBe('authenticated');
    if (result.kind !== 'authenticated') return;

    expect(result.credential).toBe('A'.repeat(43));
    expect(fixture.createSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        credentialHash: hashSessionCredential(result.credential),
        absoluteExpiresAt: new Date(NOW.getTime() + 8 * 60 * 60 * 1000),
      }),
    );
    expect(JSON.stringify(fixture.createSession.mock.calls)).not.toContain(
      result.credential,
    );
  });

  it('does not create a session if account state changes before the locked check', async () => {
    const fixture = createLoginFixture(ACCOUNT, {
      lockedAccount: { ...ACCOUNT, status: 'suspended' },
    });
    const service = await fixture.servicePromise;

    await expect(
      service.login(
        { email: ACCOUNT.email, password: '  existing password exactly  ' },
        '127.0.0.1',
      ),
    ).resolves.toEqual({ kind: 'account_restricted' });

    expect(fixture.createSession).not.toHaveBeenCalled();
  });
});

describe('session service', () => {
  it('rejects malformed credentials before repository access', async () => {
    const repository = {
      validateAndTouch: vi.fn(),
      revokeCurrentSession: vi.fn(),
    } as unknown as UserSessionRepository;
    const service: SessionService = createSessionService({
      repository,
      now: () => NOW,
    });

    await expect(service.current('not-a-session')).resolves.toBeNull();
    await expect(service.logout('not-a-session')).resolves.toBe(false);
    expect(repository.validateAndTouch).not.toHaveBeenCalled();
    expect(repository.revokeCurrentSession).not.toHaveBeenCalled();
  });
});
