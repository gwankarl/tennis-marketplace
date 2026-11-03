import { describe, expect, it, vi } from 'vitest';
import type { DatabaseTransactionExecutor } from '../../../src/db/client.js';
import type { EmailVerificationResendRepository } from '../../../src/modules/identity/verification/email-verification-resend.repository.js';
import type { EmailVerificationService } from '../../../src/modules/identity/verification/email-verification.service.js';
import { createResendVerificationService } from '../../../src/modules/identity/verification/resend-verification.service.js';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const ACKNOWLEDGEMENT = {
  data: {
    message: 'If an account needs verification, instructions may be sent.',
  },
} as const;

describe('resend verification service', () => {
  it('normalizes email and passes the same transaction to token/job creation', async () => {
    const transaction = {} as DatabaseTransactionExecutor;
    const issueForAccount = vi.fn<EmailVerificationService['issueForAccount']>(
      async () => undefined,
    );
    const queueIfAllowed = vi.fn<
      EmailVerificationResendRepository['queueIfAllowed']
    >(async (_email, _policy, queue) => {
      await queue(ACCOUNT_ID, transaction);
      return true;
    });

    const service = createResendVerificationService({
      repository: { queueIfAllowed },
      verification: { issueForAccount },
      cooldownMs: 60_000,
      maxJobsPerHour: 5,
      now: () => new Date('2026-11-02T12:00:00.000Z'),
    });

    const result = await service.resend({
      email: '  Player+Tennis@Example.test  ',
    });

    expect(queueIfAllowed).toHaveBeenCalledWith(
      'player+tennis@example.test',
      {
        now: new Date('2026-11-02T12:00:00.000Z'),
        cooldownMs: 60_000,
        maxJobsPerHour: 5,
      },
      expect.any(Function),
    );
    expect(issueForAccount).toHaveBeenCalledWith(ACCOUNT_ID, transaction);
    expect(result).toEqual(ACKNOWLEDGEMENT);
  });

  it('returns the same acknowledgement when the repository suppresses queuing', async () => {
    const queueIfAllowed = vi.fn<
      EmailVerificationResendRepository['queueIfAllowed']
    >(async () => false);
    const issueForAccount = vi.fn<EmailVerificationService['issueForAccount']>(
      async () => undefined,
    );

    const service = createResendVerificationService({
      repository: { queueIfAllowed },
      verification: { issueForAccount },
      cooldownMs: 60_000,
      maxJobsPerHour: 5,
    });

    const unknown = await service.resend({
      email: 'unknown@example.test',
    });
    const suppressed = await service.resend({
      email: 'verified@example.test',
    });

    expect(unknown).toEqual(ACKNOWLEDGEMENT);
    expect(suppressed).toEqual(unknown);
    expect(issueForAccount).not.toHaveBeenCalled();
  });

  it('does not disguise repository or encryption failures as successful acknowledgement', async () => {
    const failure = new Error('private persistence failure');
    const queueIfAllowed = vi.fn<
      EmailVerificationResendRepository['queueIfAllowed']
    >(async () => {
      throw failure;
    });

    const service = createResendVerificationService({
      repository: { queueIfAllowed },
      verification: {
        issueForAccount: vi.fn(async () => undefined),
      },
      cooldownMs: 60_000,
      maxJobsPerHour: 5,
    });

    await expect(service.resend({ email: 'player@example.test' })).rejects.toBe(
      failure,
    );
  });
});
