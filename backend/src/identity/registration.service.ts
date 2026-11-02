import type { PasswordService } from './password.service.js';
import {
  registrationRequestSchema,
  type RegistrationAcknowledgement,
  type RegistrationRequest,
} from './registration.schema.js';
import { type AccountRepository } from './account.repository.js';
import { ApplicationError } from '../http/application-error.js';

export interface RegistrationServiceDependencies {
  accounts: AccountRepository;
  passwords: Pick<PasswordService, 'screenPassword' | 'hashPassword'>;
  /** Current server-approved Terms version; never accepted from request data. */
  termsVersion: string;
  now?: () => Date;
}

export interface RegistrationService {
  register(input: RegistrationRequest): Promise<RegistrationAcknowledgement>;
}

const ACKNOWLEDGEMENT: RegistrationAcknowledgement = {
  data: { message: 'Registration request received.' },
};

/**
 * Screens and hashes before persistence for every eligible request, including
 * duplicates. Neither operation runs inside a database transaction.
 */
export function createRegistrationService(
  dependencies: RegistrationServiceDependencies,
): RegistrationService {
  if (
    dependencies.termsVersion.trim().length === 0 ||
    dependencies.termsVersion.length > 64
  ) {
    throw new Error('Invalid registration Terms version configuration.');
  }

  const now = dependencies.now ?? (() => new Date());

  return {
    async register(
      input: RegistrationRequest,
    ): Promise<RegistrationAcknowledgement> {
      const validatedInput = registrationRequestSchema.parse(input);
      const screeningResult = await dependencies.passwords.screenPassword(
        validatedInput.password,
      );

      if (screeningResult === 'compromised') {
        throw new ApplicationError(
          'VALIDATION_ERROR',
          'Choose a password that has not appeared in known data breaches.',
          [
            {
              field: 'password',
              code: 'PASSWORD_COMPROMISED',
              message:
                'Choose a password that has not appeared in known data breaches.',
            },
          ],
        );
      }

      const passwordHash = await dependencies.passwords.hashPassword(
        validatedInput.password,
      );

      await dependencies.accounts.createAccount({
        firstName: validatedInput.firstName,
        lastName: validatedInput.lastName,
        email: validatedInput.email,
        passwordHash,
        status: 'pending_email_verification',
        emailVerifiedAt: null,
        termsAcceptedVersion: dependencies.termsVersion,
        termsAcceptedAt: now(),
      });

      // Created and duplicate-email submissions intentionally return the same
      // acknowledgement; no account identity or existence signal is returned.
      return ACKNOWLEDGEMENT;
    },
  };
}
