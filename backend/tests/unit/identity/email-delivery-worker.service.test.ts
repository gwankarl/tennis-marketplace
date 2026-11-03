import { describe, expect, it, vi } from 'vitest';
import type { EmailQueueConfig } from '../../../src/config/email-queue-env.js';
import type { EmailWorkerConfig } from '../../../src/config/email-worker-env.js';
import {
  type ClaimedEmailJob,
  type EmailDeliveryRepository,
} from '../../../src/modules/identity/verification/delivery/email-delivery.repository.js';
import { createEmailDeliveryWorker } from '../../../src/modules/identity/verification/delivery/email-delivery-worker.service.js';
import { EMAIL_VERIFICATION_PURPOSE } from '../../../src/modules/identity/verification/delivery/email-delivery-job.schema.js';
import { encryptDeliveryPayload } from '../../../src/modules/identity/verification/delivery/encrypted-delivery-payload.js';
import {
  EmailTransportError,
  type EmailTransport,
} from '../../../src/infrastructure/email/email-transport.js';

const NOW = new Date('2026-11-02T12:00:00.000Z');
const JOB_ID = '00000000-0000-4000-8000-000000000010';
const CLAIM_ID = '00000000-0000-4000-8000-000000000011';
const EMAIL = 'person@example.test';
const TOKEN = 'A'.repeat(43);
const EXPIRY = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);

const queueConfig: EmailQueueConfig = {
  activeKey: {
    keyId: 'worker-unit-test-v1',
    key: Buffer.alloc(32, 7),
  },
  frontendOrigin: 'http://localhost:5173',
};

const workerConfig: EmailWorkerConfig = {
  pollIntervalMs: 1_000,
  concurrency: 1,
  leaseMs: 120_000,
  retryBaseMs: 30_000,
  retryMaxMs: 900_000,
  maxAttempts: 5,
};

function createClaim(
  overrides: Partial<ClaimedEmailJob> = {},
): ClaimedEmailJob {
  const encrypted = encryptDeliveryPayload(
    {
      recipientEmail: EMAIL,
      verificationUrl: `${queueConfig.frontendOrigin}/verify-email?token=${TOKEN}`,
      expiresAt: EXPIRY.toISOString(),
    },
    JOB_ID,
    EMAIL_VERIFICATION_PURPOSE,
    queueConfig,
  );

  return {
    id: JOB_ID,
    claimId: CLAIM_ID,
    purpose: EMAIL_VERIFICATION_PURPOSE,
    attemptCount: 1,
    keyId: encrypted.keyId,
    encryptedPayload: encrypted.serialized,
    jobExpiresAt: EXPIRY,
    tokenExpiresAt: EXPIRY,
    tokenEmail: EMAIL,
    accountEmail: EMAIL,
    ...overrides,
  };
}

function makeRepository(
  claim = createClaim(),
  overrides: Partial<EmailDeliveryRepository> = {},
): EmailDeliveryRepository {
  return {
    claimNext: vi.fn().mockResolvedValue({
      job: claim,
      cancelledCount: 0,
    }),
    getCurrentClaim: vi.fn().mockResolvedValue(claim),
    cancelClaim: vi.fn().mockResolvedValue(true),
    markSent: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
    scheduleRetry: vi.fn().mockResolvedValue('pending'),
    ...overrides,
  };
}

function makeTransport(
  send: EmailTransport['send'] = vi.fn().mockResolvedValue(undefined),
): EmailTransport {
  return { send };
}

function makeWorker(
  repository: EmailDeliveryRepository,
  transport: EmailTransport,
  options: {
    onDiagnostic?: (
      event: Parameters<
        NonNullable<
          import('../../../src/modules/identity/verification/delivery/email-delivery-worker.service.js').EmailDeliveryWorkerDependencies['onDiagnostic']
        >
      >[0],
    ) => void;
    wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  } = {},
) {
  return createEmailDeliveryWorker({
    repository,
    transport,
    queueConfig,
    workerConfig,
    now: () => NOW,
    createClaimId: () => CLAIM_ID,
    ...options,
  });
}

describe('email delivery worker', () => {
  it('sends the verification email and clears the job payload', async () => {
    const claim = createClaim();
    const repository = makeRepository(claim);
    const send = vi.fn<EmailTransport['send']>().mockResolvedValue(undefined);

    const diagnostics: unknown[] = [];

    const diagnosedWorker = makeWorker(repository, makeTransport(send), {
      onDiagnostic: (event) => diagnostics.push(event),
    });

    await expect(diagnosedWorker.runOnce()).resolves.toBe(1);

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: EMAIL,
        subject: expect.any(String),
        text: expect.stringContaining(
          `${queueConfig.frontendOrigin}/verify-email?token=${TOKEN}`,
        ),
        html: expect.stringContaining('Verify email'),
      }),
    );
    expect(repository.markSent).toHaveBeenCalledWith(
      claim.id,
      claim.claimId,
      NOW,
    );
    expect(diagnostics).toContainEqual({
      jobId: JOB_ID,
      status: 'sent',
      attemptCount: 1,
    });
  });

  it('schedules a temporary SMTP failure with exponential backoff', async () => {
    const claim = createClaim({ attemptCount: 2 });
    const repository = makeRepository(claim, {
      scheduleRetry: vi.fn().mockResolvedValue('pending'),
    });
    const send = vi
      .fn<EmailTransport['send']>()
      .mockRejectedValue(new EmailTransportError('transient'));
    const diagnostics: unknown[] = [];
    const worker = makeWorker(repository, makeTransport(send), {
      onDiagnostic: (event) => diagnostics.push(event),
    });

    await expect(worker.runOnce()).resolves.toBe(1);

    expect(repository.scheduleRetry).toHaveBeenCalledWith(
      JOB_ID,
      CLAIM_ID,
      NOW,
      new Date(NOW.getTime() + 60_000),
      5,
    );
    expect(diagnostics).toContainEqual({
      jobId: JOB_ID,
      status: 'retry_scheduled',
      attemptCount: 2,
      classification: 'temporary_smtp',
    });
  });

  it('clears the payload after permanent SMTP failure', async () => {
    const repository = makeRepository();
    const send = vi
      .fn<EmailTransport['send']>()
      .mockRejectedValue(new EmailTransportError('permanent'));
    const diagnostics: unknown[] = [];
    const worker = makeWorker(repository, makeTransport(send), {
      onDiagnostic: (event) => diagnostics.push(event),
    });

    await worker.runOnce();

    expect(repository.markFailed).toHaveBeenCalledWith(JOB_ID, CLAIM_ID, NOW);
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
    expect(diagnostics).toContainEqual({
      jobId: JOB_ID,
      status: 'failed',
      attemptCount: 1,
      classification: 'permanent_smtp',
    });
  });

  it('does not send when the account or claim is no longer eligible', async () => {
    const repository = makeRepository(createClaim(), {
      getCurrentClaim: vi.fn().mockResolvedValue(null),
    });
    const send = vi.fn<EmailTransport['send']>().mockResolvedValue(undefined);
    const worker = makeWorker(repository, makeTransport(send));

    await worker.runOnce();

    expect(send).not.toHaveBeenCalled();
    expect(repository.cancelClaim).toHaveBeenCalledWith(JOB_ID, CLAIM_ID, NOW);
  });

  it('fails malformed encrypted payloads without sending', async () => {
    const claim = createClaim({ encryptedPayload: 'invalid-ciphertext' });
    const repository = makeRepository(claim);
    const send = vi.fn<EmailTransport['send']>().mockResolvedValue(undefined);
    const diagnostics: unknown[] = [];
    const worker = makeWorker(repository, makeTransport(send), {
      onDiagnostic: (event) => diagnostics.push(event),
    });

    await worker.runOnce();

    expect(send).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalledWith(JOB_ID, CLAIM_ID, NOW);
    expect(diagnostics).toContainEqual({
      jobId: JOB_ID,
      status: 'failed',
      attemptCount: 1,
      classification: 'invalid_payload',
    });
  });

  it('waits for an in-flight send before completing graceful shutdown', async () => {
    const repository = makeRepository();
    let finishSend!: () => void;
    let sendStarted!: () => void;

    const started = new Promise<void>((resolve) => {
      sendStarted = resolve;
    });
    const sendGate = new Promise<void>((resolve) => {
      finishSend = resolve;
    });
    const send = vi.fn<EmailTransport['send']>(async () => {
      sendStarted();
      await sendGate;
    });

    const worker = makeWorker(repository, makeTransport(send));
    const controller = new AbortController();
    let runFinished = false;

    const runPromise = worker.run(controller.signal).then(() => {
      runFinished = true;
    });

    await started;
    controller.abort();
    await Promise.resolve();

    expect(runFinished).toBe(false);

    finishSend();
    await runPromise;

    expect(runFinished).toBe(true);
    expect(repository.markSent).toHaveBeenCalledOnce();
  });
});
