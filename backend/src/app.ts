import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { createLoggerOptions, type LoggerStream } from './config/logger.js';
import { registerErrorHandlers } from './http/error-handler.js';
import { configureSchemaCompilers } from './http/schema-compilers.js';
import { registerOpenApi } from './http/openapi.js';
import type { RegistrationRoutesOptions } from './identity/registration.routes.js';
import { registrationRoutes } from './identity/registration.routes.js';
import type { EmailVerificationRoutesOptions } from './identity/email-verification.routes.js';
import { emailVerificationRoutes } from './identity/email-verification.routes.js';

interface BuildAppOptions {
  loggerStream?: LoggerStream;
  registration?: RegistrationRoutesOptions;
  emailVerification?: EmailVerificationRoutesOptions;
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

  if (options.closeResources) {
    app.addHook('onClose', options.closeResources);
  }

  return app;
}
