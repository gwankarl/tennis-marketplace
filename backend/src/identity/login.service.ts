import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { normalizedEmailSchema } from './registration.schema.js';
import type { LoginAttemptCounterRepository } from './login-attempt-counter.repository.js';
import type { PasswordService } from './password.service.js';
import {
  ADMINISTRATOR_SESSION_ABSOLUTE_LIFETIME_MS,
  STANDARD_SESSION_ABSOLUTE_LIFETIME_MS,
} from './session-policy.js';
import {
  createSessionCredential,
  hashSessionCredential,
} from './session-credential.js';
import type { UserSessionRepository } from './user-session.repository.js';

export interface LoginCredentials {
  email: string;
  password: string;
}

export type LoginOutcome =
  | {
      kind: 'authenticated';
      credential: string;
      absoluteExpiresAt: Date;
      user: {
        id: string;
        firstName: string;
        lastName: string;
        isAdministrator: boolean;
      };
    }
  | { kind: 'invalid_credentials' }
  | { kind: 'email_verification_required' }
  | { kind: 'account_restricted' }
  | { kind: 'rate_limited'; retryAfterSeconds: number };

export interface LoginService {
  login(
    credentials: LoginCredentials,
    socketPeerIp: string,
  ): Promise<LoginOutcome>;
}

export interface LoginServiceDependencies {
  sessions: UserSessionRepository;
  counters: LoginAttemptCounterRepository;
  passwords: Pick<PasswordService, 'hashPassword' | 'verifyPassword'>;
  rateLimitHmacKey: string;
  ipLimit: number;
  emailLimit: number;
  windowMs: number;
  now?: () => Date;
  createCredential?: () => string;
}

function decodeHmacKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64url');

  if (
    !/^[A-Za-z0-9_-]{43}$/.test(value) ||
    key.byteLength !== 32 ||
    key.toString('base64url') !== value
  ) {
    throw new Error('Invalid login rate-limit HMAC key configuration.');
  }

  return key;
}

function privateBucketKey(
  hmacKey: Buffer,
  scope: 'ip' | 'email',
  value: string,
): string {
  return createHmac('sha256', hmacKey)
    .update(scope, 'utf8')
    .update('\0', 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

function validLimit(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 1000;
}

/**
 * Creates the dummy hash with the existing Argon2id service at startup.
 * A nonexistent account therefore still incurs a password verification.
 */
export async function createLoginService(
  dependencies: LoginServiceDependencies,
): Promise<LoginService> {
  if (
    !validLimit(dependencies.ipLimit) ||
    !validLimit(dependencies.emailLimit) ||
    !Number.isInteger(dependencies.windowMs) ||
    dependencies.windowMs < 1
  ) {
    throw new Error('Invalid login rate-limit configuration.');
  }

  const hmacKey = decodeHmacKey(dependencies.rateLimitHmacKey);
  const now = dependencies.now ?? (() => new Date());
  const makeCredential =
    dependencies.createCredential ?? createSessionCredential;

  const dummyPassword = randomBytes(32).toString('base64url');
  const dummyPasswordHash =
    await dependencies.passwords.hashPassword(dummyPassword);

  let lastCleanupAt = Number.NEGATIVE_INFINITY;
  let cleanupInProgress: Promise<void> | undefined;

  async function cleanupCountersIfDue(at: Date): Promise<void> {
    if (at.getTime() - lastCleanupAt < dependencies.windowMs) {
      return;
    }

    if (!cleanupInProgress) {
      cleanupInProgress = dependencies.counters
        .deleteExpiredCounters(at, dependencies.windowMs, 500)
        .then(() => {
          lastCleanupAt = at.getTime();
        });
    }

    const currentCleanup = cleanupInProgress;

    try {
      await currentCleanup;
    } finally {
      if (cleanupInProgress === currentCleanup) {
        cleanupInProgress = undefined;
      }
    }
  }

  return {
    async login(credentials, socketPeerIp) {
      const email = normalizedEmailSchema.parse(credentials.email);

      if (isIP(socketPeerIp) === 0) {
        throw new Error('Login requires a socket peer IP address.');
      }

      const attemptAt = new Date(now().getTime());

      await cleanupCountersIfDue(attemptAt);

      const limit = await dependencies.counters.checkAndIncrement({
        now: attemptAt,
        windowMs: dependencies.windowMs,
        ip: {
          keyHash: privateBucketKey(hmacKey, 'ip', socketPeerIp),
          max: dependencies.ipLimit,
        },
        email: {
          keyHash: privateBucketKey(hmacKey, 'email', email),
          max: dependencies.emailLimit,
        },
      });

      if (!limit.allowed) {
        return {
          kind: 'rate_limited',
          retryAfterSeconds: limit.retryAfterSeconds,
        };
      }

      // Password text is preserved exactly. Registration's 15-character
      // minimum and HIBP screening intentionally do not apply at login.
      const account =
        await dependencies.sessions.getLoginAccountByNormalizedEmail(email);
      const passwordHash = account?.passwordHash ?? dummyPasswordHash;
      const passwordMatches = await dependencies.passwords.verifyPassword(
        passwordHash,
        credentials.password,
      );

      if (!account || !passwordMatches) {
        return { kind: 'invalid_credentials' };
      }

      const credential = makeCredential();
      const credentialHash = hashSessionCredential(credential);

      if (!credentialHash) {
        throw new Error('Session credential generation failed.');
      }

      return dependencies.sessions.withLockedAccount(
        account.id,
        async (currentAccount, transaction) => {
          if (
            !currentAccount ||
            currentAccount.passwordHash !== account.passwordHash
          ) {
            return { kind: 'invalid_credentials' };
          }

          // Status is considered only after the password has matched.
          if (currentAccount.status === 'suspended') {
            return { kind: 'account_restricted' };
          }

          if (currentAccount.emailVerifiedAt === null) {
            return { kind: 'email_verification_required' };
          }

          if (currentAccount.status !== 'active') {
            return { kind: 'account_restricted' };
          }

          const createdAt = new Date(now().getTime());
          const absoluteLifetimeMs = currentAccount.isAdministrator
            ? ADMINISTRATOR_SESSION_ABSOLUTE_LIFETIME_MS
            : STANDARD_SESSION_ABSOLUTE_LIFETIME_MS;
          const absoluteExpiresAt = new Date(
            createdAt.getTime() + absoluteLifetimeMs,
          );

          await dependencies.sessions.createSession(transaction, {
            userId: currentAccount.id,
            credentialHash,
            now: createdAt,
            absoluteExpiresAt,
          });

          return {
            kind: 'authenticated',
            credential,
            absoluteExpiresAt,
            user: {
              id: currentAccount.id,
              firstName: currentAccount.firstName,
              lastName: currentAccount.lastName,
              isAdministrator: currentAccount.isAdministrator,
            },
          };
        },
      );
    },
  };
}
