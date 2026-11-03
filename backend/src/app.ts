import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { createLoggerOptions, type LoggerStream } from './config/logger.js';
import { registerErrorHandlers } from './http/error-handler.js';
import { configureSchemaCompilers } from './http/schema-compilers.js';
import { registerOpenApi } from './http/openapi.js';
import type { RegistrationRoutesOptions } from './modules/identity/registration/registration.routes.js';
import { registrationRoutes } from './modules/identity/registration/registration.routes.js';
import type { EmailVerificationRoutesOptions } from './modules/identity/verification/email-verification.routes.js';
import { emailVerificationRoutes } from './modules/identity/verification/email-verification.routes.js';
import type { ResendVerificationRoutesOptions } from './modules/identity/verification/resend-verification.routes.js';
import { resendVerificationRoutes } from './modules/identity/verification/resend-verification.routes.js';
import type { AuthenticationRoutesOptions } from './modules/identity/sessions/auth.routes.js';
import { authenticationRoutes } from './modules/identity/sessions/auth.routes.js';
import type { UserProfileRoutesOptions } from './modules/identity/accounts/profile.routes.js';
import { userProfileRoutes } from './modules/identity/accounts/profile.routes.js';
import type { PasswordResetRoutesOptions } from './modules/identity/passwords/password-reset.routes.js';
import { passwordResetRoutes } from './modules/identity/passwords/password-reset.routes.js';

interface BuildAppOptions {
  loggerStream?: LoggerStream;
  registration?: RegistrationRoutesOptions;
  resendVerification?: ResendVerificationRoutesOptions;
  emailVerification?: EmailVerificationRoutesOptions;
  authentication?: AuthenticationRoutesOptions;
  userProfile?: UserProfileRoutesOptions;
  passwordReset?: PasswordResetRoutesOptions;
  closeResources?: () => Promise<void>;
}

/**
 * Builds the API with server-generated request IDs, centralized request
 * errors, and the existing test logger-stream injection.
 */
export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    logger: createLoggerOptions(options.loggerStream),
    trustProxy: false,
  });

  registerErrorHandlers(app);

  configureSchemaCompilers(app);
  registerOpenApi(app);

  // This is a process-health check; database connectivity is checked separately.
  app.register(async function registerHealthRoute(routes) {
    routes.get('/api/v1/health', async () => ({
      data: { status: 'ok' },
    }));
  });

  if (options.emailVerification) {
    app.register(emailVerificationRoutes, options.emailVerification);
  }

  if (options.registration) {
    app.register(registrationRoutes, options.registration);
  }

  if (options.resendVerification) {
    app.register(resendVerificationRoutes, options.resendVerification);
  }

  if (options.authentication) {
    app.register(authenticationRoutes, options.authentication);
  }

  if (options.userProfile) {
    app.register(userProfileRoutes, options.userProfile);
  }

  if (options.passwordReset) {
    app.register(passwordResetRoutes, options.passwordReset);
  }

  if (options.closeResources) {
    app.addHook('onClose', options.closeResources);
  }

  return app;
}
