import type { DatabaseTransactionExecutor } from '../db/client.js';
import type { EmailVerificationResendRepository } from './email-verification-resend.repository.js';
import type { EmailVerificationService } from './email-verification.service.js';
import {
  resendVerificationAcknowledgementSchema,
  resendVerificationRequestSchema,
  type ResendVerificationAcknowledgement,
  type ResendVerificationRequest,
} from './resend-verification.schema.js';

export interface ResendVerificationService {
  resend(
    input: ResendVerificationRequest,
  ): Promise<ResendVerificationAcknowledgement>;
}

export interface ResendVerificationServiceOptions {
  repository: EmailVerificationResendRepository;
  verification: Pick<EmailVerificationService, 'issueForAccount'>;
  cooldownMs: number;
  maxJobsPerHour: number;
  now?: () => Date;
}

const ACKNOWLEDGEMENT = resendVerificationAcknowledgementSchema.parse({
  data: {
    message: 'If an account needs verification, instructions may be sent.',
  },
});

export function createResendVerificationService(
  options: ResendVerificationServiceOptions,
): ResendVerificationService {
  const now = options.now ?? (() => new Date());

  return {
    async resend(input) {
      const request = resendVerificationRequestSchema.parse(input);

      await options.repository.queueIfAllowed(
        request.email,
        {
          now: now(),
          cooldownMs: options.cooldownMs,
          maxJobsPerHour: options.maxJobsPerHour,
        },
        async (accountId: string, transaction: DatabaseTransactionExecutor) => {
          await options.verification.issueForAccount(accountId, transaction);
        },
      );

      // Unknown, verified, ineligible, cooldown-limited, and account-limited
      // addresses all receive the same acknowledgement.
      return ACKNOWLEDGEMENT;
    },
  };
}
