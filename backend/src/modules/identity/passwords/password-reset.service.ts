import { createHash } from 'node:crypto';
import { ApplicationError } from '../../../http/application-error.js';
import type { PasswordService } from './password.service.js';
import type { PasswordResetRepository } from './password-reset.repository.js';
import type { UserSessionRepository } from '../sessions/user-session.repository.js';
import { passwordResetConfirmRequestSchema } from './password-reset-confirm.schema.js';

const INVALID_RESET_MESSAGE = 'This password reset link is invalid or expired.';

export interface PasswordResetService {
  reset(input: unknown): Promise<void>;
}

export interface PasswordResetServiceOptions {
  repository: PasswordResetRepository;
  sessions: Pick<
    UserSessionRepository,
    'withLockedAccount' | 'revokeAllSessions'
  >;
  passwords: Pick<PasswordService, 'screenPassword' | 'hashPassword'>;
  now?: () => Date;
}

function invalidResetError(): ApplicationError {
  return new ApplicationError('NOT_FOUND', INVALID_RESET_MESSAGE);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createPasswordResetService(
  options: PasswordResetServiceOptions,
): PasswordResetService {
  const now = options.now ?? (() => new Date());

  return {
    async reset(input) {
      const request = passwordResetConfirmRequestSchema.parse(input);
      const tokenHash = hashToken(request.token);
      const candidate = await options.repository.findCandidate(
        tokenHash,
        new Date(now().getTime()),
      );

      if (!candidate) {
        throw invalidResetError();
      }

      // Network screening and Argon2 work remain outside the final transaction.
      const screening = await options.passwords.screenPassword(
        request.password,
      );

      if (screening === 'compromised') {
        throw new ApplicationError(
          'VALIDATION_ERROR',
          'Choose a different password.',
          [
            {
              field: 'password',
              code: 'PASSWORD_COMPROMISED',
              message: 'This password has appeared in a known data breach.',
            },
          ],
        );
      }

      const passwordHash = await options.passwords.hashPassword(
        request.password,
      );

      await options.sessions.withLockedAccount(
        candidate.accountId,
        async (account, transaction) => {
          if (
            !account ||
            account.status !== 'active' ||
            account.emailVerifiedAt === null ||
            account.email !== candidate.emailAddress
          ) {
            throw invalidResetError();
          }

          const resetAt = new Date(now().getTime());
          const completed = await options.repository.complete(
            {
              tokenId: candidate.id,
              accountId: account.id,
              emailAddress: account.email,
              tokenHash,
              passwordHash,
              now: resetAt,
            },
            transaction,
          );

          if (!completed) {
            throw invalidResetError();
          }

          // Login uses this same account lock before creating a session. Thus
          // login either precedes the reset and gets revoked, or sees the new hash.
          await options.sessions.revokeAllSessions(
            transaction,
            account.id,
            resetAt,
          );
        },
      );
    },
  };
}
