import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ApplicationError } from '../../../http/application-error.js';
import type { EmailQueueConfig } from '../../../config/email-queue-env.js';
import { EMAIL_VERIFICATION_PURPOSE } from './delivery/email-delivery-job.schema.js';
import type { EmailVerificationRepository } from './email-verification.repository.js';
import { encryptDeliveryPayload } from './delivery/encrypted-delivery-payload.js';
import type { DatabaseTransactionExecutor } from '../../../db/client.js';

const TOKEN_BYTES = 32;
const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const INVALID_TOKEN_MESSAGE = 'This verification link is invalid or expired.';

export interface EmailVerificationService {
  issueForAccount(
    accountId: string,
    transaction?: DatabaseTransactionExecutor,
  ): Promise<void>;

  consume(token: string): Promise<void>;
}

export interface EmailVerificationServiceDependencies {
  repository: EmailVerificationRepository;
  queueConfig: EmailQueueConfig | (() => EmailQueueConfig);
  now?: () => Date;
  createJobId?: () => string;
}

function invalidTokenError(): ApplicationError {
  return new ApplicationError('NOT_FOUND', INVALID_TOKEN_MESSAGE);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function buildVerificationUrl(frontendOrigin: string, token: string): string {
  const origin = new URL(frontendOrigin);

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

  const url = new URL('/verify-email', origin.origin);
  url.searchParams.set('token', token);
  return url.toString();
}

export function createEmailVerificationService(
  dependencies: EmailVerificationServiceDependencies,
): EmailVerificationService {
  const now = dependencies.now ?? (() => new Date());
  const createJobId = dependencies.createJobId ?? randomUUID;

  return {
    async issueForAccount(accountId, transaction) {
      const emailAddress =
        await dependencies.repository.getEligibleAccountEmail(
          accountId,
          transaction,
        );

      if (!emailAddress) {
        throw invalidTokenError();
      }

      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + TOKEN_LIFETIME_MS);
      const token = randomBytes(TOKEN_BYTES).toString('base64url');
      const jobId = createJobId();
      const queueConfig =
        typeof dependencies.queueConfig === 'function'
          ? dependencies.queueConfig()
          : dependencies.queueConfig;
      const verificationUrl = buildVerificationUrl(
        queueConfig.frontendOrigin,
        token,
      );
      const encrypted = encryptDeliveryPayload(
        {
          recipientEmail: emailAddress,
          verificationUrl,
          expiresAt: expiresAt.toISOString(),
        },
        jobId,
        EMAIL_VERIFICATION_PURPOSE,
        queueConfig,
      );

      const created = await dependencies.repository.createTokenAndJob(
        {
          accountId,
          emailAddress,
          tokenHash: hashToken(token),
          expiresAt,
          now: issuedAt,
          job: {
            id: jobId,
            purpose: EMAIL_VERIFICATION_PURPOSE,
            encryptionKeyId: encrypted.keyId,
            encryptedPayload: encrypted.serialized,
          },
        },
        transaction,
      );

      if (!created) {
        throw invalidTokenError();
      }
    },

    async consume(token) {
      if (!TOKEN_FORMAT.test(token)) {
        throw invalidTokenError();
      }

      const consumed = await dependencies.repository.consumeToken(
        hashToken(token),
        now(),
      );

      if (!consumed) {
        throw invalidTokenError();
      }
    },
  };
}
