import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { EmailQueueConfig } from '../../src/config/email-queue-env.js';
import type { EmailVerificationRepository } from '../../src/identity/email-verification.repository.js';
import { EMAIL_VERIFICATION_PURPOSE } from '../../src/identity/email-delivery-job.schema.js';
import { createEmailVerificationService } from '../../src/identity/email-verification.service.js';
import { decryptDeliveryPayload } from '../../src/infrastructure/email/encrypted-delivery-payload.js';

const FIXED_NOW = new Date('2026-11-02T12:00:00.000Z');
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const JOB_ID = '00000000-0000-4000-8000-000000000002';

const queueConfig: EmailQueueConfig = {
  activeKey: {
    keyId: 'unit-test-v1',
    key: Buffer.alloc(32, 7),
  },
  frontendOrigin: 'http://localhost:5173',
};

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function createRepository(
  overrides: Partial<EmailVerificationRepository> = {},
): EmailVerificationRepository {
  return {
    getEligibleAccountEmail: vi
      .fn<EmailVerificationRepository['getEligibleAccountEmail']>()
      .mockResolvedValue('person@example.test'),
    createTokenAndJob: vi
      .fn<EmailVerificationRepository['createTokenAndJob']>()
      .mockResolvedValue(true),
    consumeToken: vi
      .fn<EmailVerificationRepository['consumeToken']>()
      .mockResolvedValue(true),
    cancelExpiredJobs: vi
      .fn<EmailVerificationRepository['cancelExpiredJobs']>()
      .mockResolvedValue(0),
    ...overrides,
  };
}

describe('email verification service and encrypted queue creation', () => {
  it('prepares a hashed token and encrypted job with the original 24-hour expiry', async () => {
    const repository = createRepository();
    const service = createEmailVerificationService({
      repository,
      queueConfig,
      now: () => FIXED_NOW,
      createJobId: () => JOB_ID,
    });

    const result = await service.issueForAccount(ACCOUNT_ID);

    expect(result).toBeUndefined();
    expect(repository.getEligibleAccountEmail).toHaveBeenCalledWith(
      ACCOUNT_ID,
      undefined,
    );
    expect(repository.createTokenAndJob).toHaveBeenCalledOnce();

    const [record] = vi.mocked(repository.createTokenAndJob).mock.calls[0]!;
    const expectedExpiry = new Date(FIXED_NOW.getTime() + 24 * 60 * 60 * 1000);
    const payload = decryptDeliveryPayload(
      {
        keyId: record.job.encryptionKeyId,
        serialized: record.job.encryptedPayload,
      },
      JOB_ID,
      EMAIL_VERIFICATION_PURPOSE,
      queueConfig,
    );
    const verificationUrl = new URL(payload.verificationUrl);
    const rawToken = verificationUrl.searchParams.get('token');

    expect(record.accountId).toBe(ACCOUNT_ID);
    expect(record.emailAddress).toBe('person@example.test');
    expect(record.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(record.tokenHash).toBe(tokenHash(rawToken!));
    expect(record.expiresAt).toEqual(expectedExpiry);
    expect(payload.expiresAt).toBe(expectedExpiry.toISOString());
    expect(payload.recipientEmail).toBe('person@example.test');
    expect(verificationUrl.origin).toBe(queueConfig.frontendOrigin);
    expect(verificationUrl.pathname).toBe('/verify-email');
    expect(record.job.id).toBe(JOB_ID);
    expect(record.job.purpose).toBe(EMAIL_VERIFICATION_PURPOSE);
    expect(record.job.encryptedPayload).not.toContain(rawToken);
    expect(record.job.encryptedPayload).not.toContain(payload.verificationUrl);
  });

  it('does not create token or job when the account is ineligible', async () => {
    const repository = createRepository({
      getEligibleAccountEmail: vi
        .fn<EmailVerificationRepository['getEligibleAccountEmail']>()
        .mockResolvedValue(null),
    });
    const service = createEmailVerificationService({
      repository,
      queueConfig,
      now: () => FIXED_NOW,
      createJobId: () => JOB_ID,
    });

    await expect(service.issueForAccount(ACCOUNT_ID)).rejects.toMatchObject({
      name: 'ApplicationError',
      code: 'NOT_FOUND',
      message: 'This verification link is invalid or expired.',
    });

    expect(repository.createTokenAndJob).not.toHaveBeenCalled();
  });

  it('returns the same safe error if transactional creation reports ineligible state', async () => {
    const repository = createRepository({
      createTokenAndJob: vi
        .fn<EmailVerificationRepository['createTokenAndJob']>()
        .mockResolvedValue(false),
    });
    const service = createEmailVerificationService({
      repository,
      queueConfig,
      now: () => FIXED_NOW,
      createJobId: () => JOB_ID,
    });

    await expect(service.issueForAccount(ACCOUNT_ID)).rejects.toMatchObject({
      name: 'ApplicationError',
      code: 'NOT_FOUND',
      message: 'This verification link is invalid or expired.',
    });
  });

  it('passes only a token hash to persistence when consuming', async () => {
    const rawToken = 'A'.repeat(43);
    const repository = createRepository();
    const service = createEmailVerificationService({
      repository,
      queueConfig,
      now: () => FIXED_NOW,
    });

    await service.consume(rawToken);

    expect(repository.consumeToken).toHaveBeenCalledWith(
      tokenHash(rawToken),
      FIXED_NOW,
    );
    expect(
      JSON.stringify(vi.mocked(repository.consumeToken).mock.calls),
    ).not.toContain(rawToken);
  });

  it('uses the same safe error for malformed and unrecognized tokens', async () => {
    const repository = createRepository({
      consumeToken: vi
        .fn<EmailVerificationRepository['consumeToken']>()
        .mockResolvedValue(false),
    });
    const service = createEmailVerificationService({
      repository,
      queueConfig,
      now: () => FIXED_NOW,
    });

    await expect(service.consume('malformed')).rejects.toMatchObject({
      name: 'ApplicationError',
      code: 'NOT_FOUND',
      message: 'This verification link is invalid or expired.',
    });
    await expect(service.consume('B'.repeat(43))).rejects.toMatchObject({
      name: 'ApplicationError',
      code: 'NOT_FOUND',
      message: 'This verification link is invalid or expired.',
    });

    expect(repository.consumeToken).toHaveBeenCalledOnce();
  });
});
