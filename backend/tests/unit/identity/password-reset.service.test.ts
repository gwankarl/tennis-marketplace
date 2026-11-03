import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { EmailQueueConfig } from '../../../src/config/email-queue-env.js';
import type { DatabaseTransactionExecutor } from '../../../src/db/client.js';
import { ApplicationError } from '../../../src/http/application-error.js';
import type { PasswordResetRepository } from '../../../src/modules/identity/passwords/password-reset.repository.js';
import type { PasswordResetRequestRepository } from '../../../src/modules/identity/passwords/password-reset-request.repository.js';
import { createPasswordResetRequestService } from '../../../src/modules/identity/passwords/password-reset-request.service.js';
import type {
  LoginAccountRecord,
  LockedAccountOperation,
  UserSessionRepository,
} from '../../../src/modules/identity/sessions/user-session.repository.js';
import type { PasswordService } from '../../../src/modules/identity/passwords/password.service.js';
import { createPasswordResetService } from '../../../src/modules/identity/passwords/password-reset.service.js';
import { decryptDeliveryPayload } from '../../../src/modules/identity/verification/delivery/encrypted-delivery-payload.js';
import { PASSWORD_RESET_PURPOSE } from '../../../src/modules/identity/verification/delivery/email-delivery-job.schema.js';

const NOW = new Date('2026-11-02T12:00:00.000Z');
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const TOKEN = 'A'.repeat(43);
const PASSWORD = '  a replacement password exactly  ';

const queueConfig: EmailQueueConfig = {
  activeKey: {
    keyId: 'password-reset-unit-v1',
    key: Buffer.alloc(32, 11),
  },
  frontendOrigin: 'http://localhost:5173',
};

const acknowledgement = {
  data: {
    message:
      'If an account is eligible for a password reset, instructions may be sent.',
  },
} as const;

const transaction = {} as DatabaseTransactionExecutor;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function makeRequestService(options: { allowed?: boolean } = {}) {
  const createTokenAndJob = vi.fn<
    PasswordResetRequestRepository['createTokenAndJob']
  >(async () => true);

  const queueIfAllowed = vi.fn<
    PasswordResetRequestRepository['queueIfAllowed']
  >(async (_email, _policy, queue) => {
    if (options.allowed === false) {
      return false;
    }

    await queue({ id: ACCOUNT_ID, email: 'player@example.test' }, transaction);
    return true;
  });

  const repository: PasswordResetRequestRepository = {
    queueIfAllowed,
    createTokenAndJob,
  };

  const service = createPasswordResetRequestService({
    repository,
    queueConfig,
    cooldownMs: 60_000,
    maxJobsPerHour: 5,
    now: () => NOW,
    createJobId: () => '00000000-0000-4000-8000-000000000002',
  });

  return { service, queueIfAllowed, createTokenAndJob };
}

const activeAccount: LoginAccountRecord = {
  id: ACCOUNT_ID,
  email: 'player@example.test',
  firstName: 'Test',
  lastName: 'Player',
  passwordHash: 'old-hash',
  status: 'active',
  emailVerifiedAt: NOW,
  isAdministrator: false,
};

function makeResetService(
  options: {
    candidate?: { id: string; accountId: string; emailAddress: string } | null;
    lockedAccount?: LoginAccountRecord | null;
    complete?: boolean;
    screening?: 'clear' | 'compromised';
    screeningError?: Error;
  } = {},
) {
  const candidate =
    options.candidate === undefined
      ? {
          id: '00000000-0000-4000-8000-000000000003',
          accountId: ACCOUNT_ID,
          emailAddress: activeAccount.email,
        }
      : options.candidate;

  const findCandidate = vi.fn<PasswordResetRepository['findCandidate']>(
    async () => candidate,
  );
  const complete = vi.fn<PasswordResetRepository['complete']>(
    async () => options.complete ?? true,
  );

  const repository: PasswordResetRepository = { findCandidate, complete };
  const lockedUserIds: string[] = [];
  const revocations: Array<{
    transaction: DatabaseTransactionExecutor;
    userId: string;
    at: Date;
  }> = [];

  const withLockedAccount: UserSessionRepository['withLockedAccount'] = async <
    T,
  >(
    userId: string,
    operation: LockedAccountOperation<T>,
  ): Promise<T> => {
    lockedUserIds.push(userId);
    return operation(
      options.lockedAccount === undefined
        ? activeAccount
        : options.lockedAccount,
      transaction,
    );
  };

  const sessions: Pick<
    UserSessionRepository,
    'withLockedAccount' | 'revokeAllSessions'
  > = {
    withLockedAccount,
    async revokeAllSessions(tx, userId, at) {
      revocations.push({ transaction: tx, userId, at });
      return 1;
    },
  };

  const screenPassword = vi.fn<PasswordService['screenPassword']>(
    async () => options.screening ?? 'clear',
  );
  if (options.screeningError) {
    screenPassword.mockRejectedValue(options.screeningError);
  }

  const hashPassword = vi.fn<PasswordService['hashPassword']>(
    async () => 'new-password-hash',
  );

  const service = createPasswordResetService({
    repository,
    sessions,
    passwords: { screenPassword, hashPassword },
    now: () => NOW,
  });

  return {
    service,
    findCandidate,
    complete,
    screenPassword,
    hashPassword,
    lockedUserIds,
    revocations,
  };
}

describe('password reset request service', () => {
  it('normalizes email and creates a hashed token with an encrypted 30-minute job', async () => {
    const { service, queueIfAllowed, createTokenAndJob } = makeRequestService();

    const result = await service.requestReset({
      email: '  Player@Example.test  ',
    });

    expect(result).toEqual(acknowledgement);
    expect(queueIfAllowed).toHaveBeenCalledWith(
      'player@example.test',
      {
        now: NOW,
        cooldownMs: 60_000,
        maxJobsPerHour: 5,
      },
      expect.any(Function),
    );
    expect(createTokenAndJob).toHaveBeenCalledOnce();

    const [record, recordedTransaction] = createTokenAndJob.mock.calls[0]!;
    expect(recordedTransaction).toBe(transaction);
    expect(record.accountId).toBe(ACCOUNT_ID);
    expect(record.emailAddress).toBe('player@example.test');
    expect(record.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.expiresAt).toEqual(new Date(NOW.getTime() + 30 * 60 * 1000));
    expect(record.job.id).toBe('00000000-0000-4000-8000-000000000002');

    const payload = decryptDeliveryPayload(
      {
        keyId: record.job.encryptionKeyId,
        serialized: record.job.encryptedPayload,
      },
      record.job.id,
      PASSWORD_RESET_PURPOSE,
      queueConfig,
    );
    const resetUrl = new URL(payload.passwordResetUrl);
    const rawToken = resetUrl.searchParams.get('token');

    expect(resetUrl.origin).toBe(queueConfig.frontendOrigin);
    expect(resetUrl.pathname).toBe('/reset-password');
    expect(payload.recipientEmail).toBe('player@example.test');
    expect(payload.expiresAt).toBe(record.expiresAt.toISOString());
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(record.tokenHash).toBe(sha256(rawToken!));
    expect(record.job.encryptedPayload).not.toContain(rawToken);
    expect(JSON.stringify(result)).not.toContain(rawToken);
  });

  it('returns the same generic acknowledgement when queuing is suppressed', async () => {
    const { service, createTokenAndJob } = makeRequestService({
      allowed: false,
    });

    await expect(
      service.requestReset({ email: 'unknown@example.test' }),
    ).resolves.toEqual(acknowledgement);
    expect(createTokenAndJob).not.toHaveBeenCalled();
  });

  it('does not disguise persistence failures as successful acknowledgements', async () => {
    const failure = new Error('private database detail');
    const repository: PasswordResetRequestRepository = {
      queueIfAllowed: vi.fn(async () => {
        throw failure;
      }),
      createTokenAndJob: vi.fn(async () => true),
    };
    const service = createPasswordResetRequestService({
      repository,
      queueConfig,
      cooldownMs: 60_000,
      maxJobsPerHour: 5,
      now: () => NOW,
    });

    await expect(
      service.requestReset({ email: 'player@example.test' }),
    ).rejects.toBe(failure);
  });
});

describe('password reset service', () => {
  it('preserves the password input and completes with the account lock transaction', async () => {
    const harness = makeResetService();

    await harness.service.reset({ token: TOKEN, password: PASSWORD });

    expect(harness.findCandidate).toHaveBeenCalledWith(sha256(TOKEN), NOW);
    expect(harness.screenPassword).toHaveBeenCalledWith(PASSWORD);
    expect(harness.hashPassword).toHaveBeenCalledWith(PASSWORD);
    expect(harness.lockedUserIds).toEqual([ACCOUNT_ID]);
    expect(harness.complete).toHaveBeenCalledOnce();

    const [completion, completionTransaction] = harness.complete.mock.calls[0]!;
    expect(completionTransaction).toBe(transaction);
    expect(completion).toMatchObject({
      accountId: ACCOUNT_ID,
      emailAddress: activeAccount.email,
      tokenHash: sha256(TOKEN),
      passwordHash: 'new-password-hash',
      now: NOW,
    });
    expect(harness.revocations).toEqual([
      { transaction, userId: ACCOUNT_ID, at: NOW },
    ]);
  });

  it('does not screen or hash a missing, expired, or already-used token', async () => {
    const harness = makeResetService({ candidate: null });

    await expect(
      harness.service.reset({ token: TOKEN, password: PASSWORD }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'This password reset link is invalid or expired.',
    });

    expect(harness.screenPassword).not.toHaveBeenCalled();
    expect(harness.hashPassword).not.toHaveBeenCalled();
    expect(harness.complete).not.toHaveBeenCalled();
  });

  it('rejects a compromised password before hashing or opening the final transaction', async () => {
    const harness = makeResetService({ screening: 'compromised' });

    await expect(
      harness.service.reset({ token: TOKEN, password: PASSWORD }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [
        expect.objectContaining({
          field: 'password',
          code: 'PASSWORD_COMPROMISED',
        }),
      ],
    });

    expect(harness.hashPassword).not.toHaveBeenCalled();
    expect(harness.complete).not.toHaveBeenCalled();
    expect(harness.revocations).toHaveLength(0);
  });

  it('propagates screening outages without hashing or changing account state', async () => {
    const outage = new ApplicationError(
      'SERVICE_UNAVAILABLE',
      'Password screening is temporarily unavailable.',
    );
    const harness = makeResetService({ screeningError: outage });

    await expect(
      harness.service.reset({ token: TOKEN, password: PASSWORD }),
    ).rejects.toBe(outage);

    expect(harness.hashPassword).not.toHaveBeenCalled();
    expect(harness.complete).not.toHaveBeenCalled();
    expect(harness.revocations).toHaveLength(0);
  });

  it('rechecks account eligibility inside the lock before changing credentials', async () => {
    const suspended = { ...activeAccount, status: 'suspended' };
    const harness = makeResetService({ lockedAccount: suspended });

    await expect(
      harness.service.reset({ token: TOKEN, password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(harness.complete).not.toHaveBeenCalled();
    expect(harness.revocations).toHaveLength(0);
  });

  it('does not revoke sessions when the token loses the final consume race', async () => {
    const harness = makeResetService({ complete: false });

    await expect(
      harness.service.reset({ token: TOKEN, password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(harness.complete).toHaveBeenCalledOnce();
    expect(harness.revocations).toHaveLength(0);
  });
});
