import { randomUUID } from 'node:crypto';
import type { EmailQueueConfig } from '../../../../config/email-queue-env.js';
import type { EmailWorkerConfig } from '../../../../config/email-worker-env.js';
import {
  EmailTransportError,
  type EmailTransport,
} from '../../../../infrastructure/email/email-transport.js';
import {
  decryptDeliveryPayload,
  EncryptedDeliveryPayloadError,
} from './encrypted-delivery-payload.js';
import { renderVerificationEmail } from './verification-email.js';
import type {
  EmailDeliveryRepository,
  RetryResult,
} from './email-delivery.repository.js';

export type EmailWorkerClassification =
  | 'temporary_smtp'
  | 'permanent_smtp'
  | 'invalid_payload'
  | 'account_ineligible'
  | 'expired'
  | 'attempts_exhausted'
  | 'database_failure'
  | 'claim_lost';

export interface EmailWorkerDiagnostic {
  jobId?: string;
  status: 'sent' | 'retry_scheduled' | 'failed' | 'cancelled' | 'warning';
  attemptCount?: number;
  classification?: EmailWorkerClassification;
}

export interface EmailDeliveryWorker {
  runOnce(): Promise<number>;
  run(signal: AbortSignal): Promise<void>;
}

export interface EmailDeliveryWorkerDependencies {
  repository: EmailDeliveryRepository;
  transport: EmailTransport;
  queueConfig: EmailQueueConfig;
  workerConfig: EmailWorkerConfig;
  now?: () => Date;
  createClaimId?: () => string;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  onDiagnostic?: (event: EmailWorkerDiagnostic) => void;
}

function waitForPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };

    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

export function createEmailDeliveryWorker(
  dependencies: EmailDeliveryWorkerDependencies,
): EmailDeliveryWorker {
  const now = dependencies.now ?? (() => new Date());
  const createClaimId = dependencies.createClaimId ?? randomUUID;
  const wait = dependencies.wait ?? waitForPoll;

  function report(event: EmailWorkerDiagnostic): void {
    try {
      dependencies.onDiagnostic?.(event);
    } catch {
      // Diagnostics must never interrupt queue state transitions.
    }
  }

  async function markFailed(
    jobId: string,
    claimId: string,
    attemptCount: number,
    classification: EmailWorkerClassification,
  ): Promise<void> {
    const updated = await dependencies.repository.markFailed(
      jobId,
      claimId,
      now(),
    );

    report({
      jobId,
      status: updated ? 'failed' : 'warning',
      attemptCount,
      classification: updated ? classification : 'claim_lost',
    });
  }

  async function processOne(): Promise<boolean> {
    const claimedAt = now();
    const claimId = createClaimId();

    let claimResult;
    try {
      claimResult = await dependencies.repository.claimNext(
        claimedAt,
        new Date(claimedAt.getTime() + dependencies.workerConfig.leaseMs),
        claimId,
        dependencies.workerConfig.maxAttempts,
      );
    } catch {
      report({
        status: 'warning',
        classification: 'database_failure',
      });
      return false;
    }

    if (claimResult.cancelledCount > 0) {
      report({
        status: 'cancelled',
        classification: 'expired',
      });
    }

    const claimed = claimResult.job;
    if (!claimed) return false;

    let current;
    try {
      current = await dependencies.repository.getCurrentClaim(
        claimed.id,
        claimed.claimId,
        now(),
      );
    } catch {
      report({
        jobId: claimed.id,
        status: 'warning',
        attemptCount: claimed.attemptCount,
        classification: 'database_failure',
      });
      return true;
    }

    if (!current) {
      try {
        const cancelled = await dependencies.repository.cancelClaim(
          claimed.id,
          claimed.claimId,
          now(),
        );
        report({
          jobId: claimed.id,
          status: cancelled ? 'cancelled' : 'warning',
          attemptCount: claimed.attemptCount,
          classification: cancelled ? 'account_ineligible' : 'claim_lost',
        });
      } catch {
        report({
          jobId: claimed.id,
          status: 'warning',
          attemptCount: claimed.attemptCount,
          classification: 'database_failure',
        });
      }
      return true;
    }

    let payload;
    try {
      payload = decryptDeliveryPayload(
        {
          keyId: current.keyId,
          serialized: current.encryptedPayload,
        },
        current.id,
        current.purpose,
        dependencies.queueConfig,
      );
    } catch (error) {
      if (!(error instanceof EncryptedDeliveryPayloadError)) {
        report({
          jobId: current.id,
          status: 'warning',
          attemptCount: current.attemptCount,
          classification: 'database_failure',
        });
        return true;
      }

      try {
        await markFailed(
          current.id,
          current.claimId,
          current.attemptCount,
          'invalid_payload',
        );
      } catch {
        report({
          jobId: current.id,
          status: 'warning',
          attemptCount: current.attemptCount,
          classification: 'database_failure',
        });
      }
      return true;
    }

    let message;
    try {
      message = renderVerificationEmail(
        payload,
        dependencies.queueConfig.frontendOrigin,
        current.accountEmail,
        current.tokenExpiresAt,
      );
    } catch {
      try {
        await markFailed(
          current.id,
          current.claimId,
          current.attemptCount,
          'invalid_payload',
        );
      } catch {
        report({
          jobId: current.id,
          status: 'warning',
          attemptCount: current.attemptCount,
          classification: 'database_failure',
        });
      }
      return true;
    }

    try {
      await dependencies.transport.send(message);
    } catch (error) {
      if (!(error instanceof EmailTransportError)) {
        try {
          await markFailed(
            current.id,
            current.claimId,
            current.attemptCount,
            'permanent_smtp',
          );
        } catch {
          report({
            jobId: current.id,
            status: 'warning',
            attemptCount: current.attemptCount,
            classification: 'database_failure',
          });
        }
        return true;
      }

      if (error.failureKind === 'permanent') {
        try {
          await markFailed(
            current.id,
            current.claimId,
            current.attemptCount,
            'permanent_smtp',
          );
        } catch {
          report({
            jobId: current.id,
            status: 'warning',
            attemptCount: current.attemptCount,
            classification: 'database_failure',
          });
        }
        return true;
      }

      const retryDelay = Math.min(
        dependencies.workerConfig.retryBaseMs * 2 ** (current.attemptCount - 1),
        dependencies.workerConfig.retryMaxMs,
      );
      const retryAt = new Date(now().getTime() + retryDelay);

      let result: RetryResult;
      try {
        result = await dependencies.repository.scheduleRetry(
          current.id,
          current.claimId,
          now(),
          retryAt,
          dependencies.workerConfig.maxAttempts,
        );
      } catch {
        report({
          jobId: current.id,
          status: 'warning',
          attemptCount: current.attemptCount,
          classification: 'database_failure',
        });
        return true;
      }

      report({
        jobId: current.id,
        status:
          result === 'pending'
            ? 'retry_scheduled'
            : result === 'failed'
              ? 'failed'
              : result === 'cancelled'
                ? 'cancelled'
                : 'warning',
        attemptCount: current.attemptCount,
        classification:
          result === 'pending'
            ? 'temporary_smtp'
            : result === 'failed'
              ? 'attempts_exhausted'
              : result === 'cancelled'
                ? 'expired'
                : 'claim_lost',
      });
      return true;
    }

    try {
      const updated = await dependencies.repository.markSent(
        current.id,
        current.claimId,
        now(),
      );

      report({
        jobId: current.id,
        status: updated ? 'sent' : 'warning',
        attemptCount: current.attemptCount,
        ...(updated ? {} : { classification: 'claim_lost' as const }),
      });
    } catch {
      // SMTP may have accepted the email. Leave the lease for recovery; retry
      // can produce a duplicate, which is why delivery is at least once.
      report({
        jobId: current.id,
        status: 'warning',
        attemptCount: current.attemptCount,
        classification: 'database_failure',
      });
    }

    return true;
  }

  return {
    async runOnce() {
      const outcomes = await Promise.all(
        Array.from({ length: dependencies.workerConfig.concurrency }, () =>
          processOne(),
        ),
      );

      return outcomes.filter(Boolean).length;
    },

    async run(signal) {
      while (!signal.aborted) {
        await this.runOnce();
        if (!signal.aborted) {
          await wait(dependencies.workerConfig.pollIntervalMs, signal);
        }
      }
    },
  };
}
