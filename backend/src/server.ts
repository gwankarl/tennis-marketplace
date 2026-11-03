// Load and validate DATABASE_URL; this does not open a database connection.
import { env } from './config/runtime-env.js';
import { buildApp } from './app.js';
import { closeDatabase, db } from './db/client.js';
import { createAccountRepository } from './modules/identity/accounts/account.repository.js';
import { createRegistrationService } from './modules/identity/registration/registration.service.js';
import {
  hashPassword,
  screenPassword,
  verifyPassword,
} from './modules/identity/passwords/password.service.js';
import { parseEmailQueueConfig } from './config/email-queue-env.js';
import { createEmailVerificationRepository } from './modules/identity/verification/email-verification.repository.js';
import { createEmailVerificationService } from './modules/identity/verification/email-verification.service.js';
import { createWorkspaceAccessRepository } from './modules/identity/accounts/workspace-access.repository.js';
import { createEmailVerificationResendRepository } from './modules/identity/verification/email-verification-resend.repository.js';
import { createResendVerificationService } from './modules/identity/verification/resend-verification.service.js';
import { createLoginAttemptCounterRepository } from './modules/identity/sessions/login-attempt-counter.repository.js';
import { createUserSessionRepository } from './modules/identity/sessions/user-session.repository.js';
import { createLoginService } from './modules/identity/sessions/login.service.js';
import { createSessionService } from './modules/identity/sessions/session.service.js';
import { createUserProfileService } from './modules/identity/accounts/profile.service.js';
import { createPasswordResetRequestRepository } from './modules/identity/passwords/password-reset-request.repository.js';
import { createPasswordResetRequestService } from './modules/identity/passwords/password-reset-request.service.js';
import { createPasswordResetRepository } from './modules/identity/passwords/password-reset.repository.js';
import { createPasswordResetService } from './modules/identity/passwords/password-reset.service.js';

const verificationService = createEmailVerificationService({
  repository: createEmailVerificationRepository(db),
  // Queue secrets are validated only when registration needs to create a job.
  // Health-only checks and API startup do not require SMTP or queue settings.
  queueConfig: () => parseEmailQueueConfig(process.env),
});

const resendVerificationService = createResendVerificationService({
  repository: createEmailVerificationResendRepository(db),
  verification: verificationService,
  cooldownMs: env.RESEND_VERIFICATION_ACCOUNT_COOLDOWN_MS,
  maxJobsPerHour: env.RESEND_VERIFICATION_ACCOUNT_MAX_PER_HOUR,
});

const passwordResetRequestService = createPasswordResetRequestService({
  repository: createPasswordResetRequestRepository(db),
  // Queue secrets are read only when an eligible request enqueues a job.
  queueConfig: () => parseEmailQueueConfig(process.env),
  cooldownMs: env.PASSWORD_RESET_ACCOUNT_COOLDOWN_MS,
  maxJobsPerHour: env.PASSWORD_RESET_ACCOUNT_MAX_PER_HOUR,
});

const accountRepository = createAccountRepository(db);

const registrationService = createRegistrationService({
  accounts: accountRepository,
  passwords: { screenPassword, hashPassword },
  verification: verificationService,
  termsVersion: env.TERMS_VERSION,
});

const userSessions = createUserSessionRepository(db);

const passwordResetService = createPasswordResetService({
  repository: createPasswordResetRepository(db),
  sessions: userSessions,
  passwords: { screenPassword, hashPassword },
});

const sessionService = createSessionService({
  repository: userSessions,
});
const userProfileService = createUserProfileService({
  accounts: accountRepository,
});

let app: ReturnType<typeof buildApp> | undefined;
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (app) {
    app.log.info({ signal }, 'Closing API server');

    try {
      await app.close();
      process.exitCode = 0;
    } catch (error: unknown) {
      app.log.error(error, 'Error while closing API server');
      process.exitCode = 1;
    }

    return;
  }

  await closeDatabase();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch(() => {
      process.exitCode = 1;
    });
  });
}

async function start(): Promise<void> {
  try {
    const loginService = await createLoginService({
      sessions: userSessions,
      counters: createLoginAttemptCounterRepository(db),
      passwords: { hashPassword, verifyPassword },
      rateLimitHmacKey: env.LOGIN_RATE_LIMIT_HMAC_KEY,
      ipLimit: env.LOGIN_RATE_LIMIT_IP_MAX,
      emailLimit: env.LOGIN_RATE_LIMIT_EMAIL_MAX,
      windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
    });

    if (shuttingDown) {
      return;
    }

    app = buildApp({
      registration: {
        service: registrationService,
        rateLimitMax: env.REGISTRATION_RATE_LIMIT_MAX,
        rateLimitWindowMs: env.REGISTRATION_RATE_LIMIT_WINDOW_MS,
      },
      emailVerification: {
        service: verificationService,
      },
      resendVerification: {
        service: resendVerificationService,
        ipRateLimitMax: env.RESEND_VERIFICATION_IP_RATE_LIMIT_MAX,
        ipRateLimitWindowMs: env.RESEND_VERIFICATION_IP_RATE_LIMIT_WINDOW_MS,
      },
      authentication: {
        login: loginService,
        sessions: sessionService,
        workspaces: createWorkspaceAccessRepository(db),
      },
      userProfile: {
        service: userProfileService,
        sessions: sessionService,
      },
      passwordReset: {
        requests: passwordResetRequestService,
        reset: passwordResetService,
        ipRateLimitMax: env.PASSWORD_RESET_IP_RATE_LIMIT_MAX,
        ipRateLimitWindowMs: env.PASSWORD_RESET_IP_RATE_LIMIT_WINDOW_MS,
      },
      closeResources: closeDatabase,
    });

    const address = await app.listen({ host: env.HOST, port: env.PORT });
    app.log.info({ address }, 'API server listening');
  } catch (error: unknown) {
    if (app) {
      app.log.error(error, 'Unable to start API server');
    } else {
      process.stderr.write(
        'Unable to start API server. Check local configuration and service availability; values are not shown.\n',
      );
    }

    process.exitCode = 1;
    await closeDatabase();
  }
}

void start();
