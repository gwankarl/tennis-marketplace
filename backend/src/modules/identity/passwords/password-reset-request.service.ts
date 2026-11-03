import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { EmailQueueConfig } from '../../../config/email-queue-env.js';
import { PASSWORD_RESET_PURPOSE } from '../verification/delivery/email-delivery-job.schema.js';
import { encryptDeliveryPayload } from '../verification/delivery/encrypted-delivery-payload.js';
import type { PasswordResetRequestRepository } from './password-reset-request.repository.js';
import {
  passwordResetAcknowledgementSchema,
  passwordResetRequestSchema,
  type PasswordResetAcknowledgement,
} from './password-reset-request.schema.js';

const TOKEN_BYTES = 32;
const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface PasswordResetRequestService {
  requestReset(input: unknown): Promise<PasswordResetAcknowledgement>;
}

export interface PasswordResetRequestServiceOptions {
  repository: PasswordResetRequestRepository;
  queueConfig: EmailQueueConfig | (() => EmailQueueConfig);
  cooldownMs: number;
  maxJobsPerHour: number;
  now?: () => Date;
  createJobId?: () => string;
}

const ACKNOWLEDGEMENT = passwordResetAcknowledgementSchema.parse({
  data: {
    message:
      'If an account is eligible for a password reset, instructions may be sent.',
  },
});

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function buildPasswordResetUrl(frontendOrigin: string, token: string): string {
  let origin: URL;

  try {
    origin = new URL(frontendOrigin);
  } catch {
    throw new Error('Invalid configured frontend origin.');
  }

  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error('Invalid configured frontend origin.');
  }

  const url = new URL('/reset-password', origin.origin);
  url.searchParams.set('token', token);
  return url.toString();
}

export function createPasswordResetRequestService(
  options: PasswordResetRequestServiceOptions,
): PasswordResetRequestService {
  const now = options.now ?? (() => new Date());
  const createJobId = options.createJobId ?? randomUUID;

  return {
    async requestReset(input) {
      const request = passwordResetRequestSchema.parse(input);
      const requestedAt = new Date(now().getTime());

      await options.repository.queueIfAllowed(
        request.email,
        {
          now: requestedAt,
          cooldownMs: options.cooldownMs,
          maxJobsPerHour: options.maxJobsPerHour,
        },
        async (account, transaction) => {
          const issuedAt = new Date(requestedAt.getTime());
          const expiresAt = new Date(issuedAt.getTime() + TOKEN_LIFETIME_MS);
          const token = randomBytes(TOKEN_BYTES).toString('base64url');

          if (!TOKEN_PATTERN.test(token)) {
            throw new Error('Generated password reset token is invalid.');
          }

          const jobId = createJobId();
          const queueConfig =
            typeof options.queueConfig === 'function'
              ? options.queueConfig()
              : options.queueConfig;
          const passwordResetUrl = buildPasswordResetUrl(
            queueConfig.frontendOrigin,
            token,
          );
          const encrypted = encryptDeliveryPayload(
            {
              recipientEmail: account.email,
              passwordResetUrl,
              expiresAt: expiresAt.toISOString(),
            },
            jobId,
            PASSWORD_RESET_PURPOSE,
            queueConfig,
          );

          // The repository owns the transaction and rechecks account eligibility.
          // A false result is suppressed with the same generic acknowledgement.
          await options.repository.createTokenAndJob(
            {
              accountId: account.id,
              emailAddress: account.email,
              tokenHash: hashToken(token),
              expiresAt,
              now: issuedAt,
              job: {
                id: jobId,
                encryptionKeyId: encrypted.keyId,
                encryptedPayload: encrypted.serialized,
              },
            },
            transaction,
          );
        },
      );

      return ACKNOWLEDGEMENT;
    },
  };
}
