// Load and validate DATABASE_URL; this does not open a database connection.
import { env } from './config/runtime-env.js';
import { buildApp } from './app.js';
import { closeDatabase, db } from './db/client.js';
import { createAccountRepository } from './identity/account.repository.js';
import { createRegistrationService } from './identity/registration.service.js';
import { hashPassword, screenPassword } from './identity/password.service.js';

const registrationService = createRegistrationService({
  accounts: createAccountRepository(db),
  passwords: { screenPassword, hashPassword },
  termsVersion: env.TERMS_VERSION,
});

const app = buildApp({
  registration: {
    service: registrationService,
    rateLimitMax: env.REGISTRATION_RATE_LIMIT_MAX,
    rateLimitWindowMs: env.REGISTRATION_RATE_LIMIT_WINDOW_MS,
  },
  closeResources: closeDatabase,
});

let shuttingDown = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;

    app.log.info({ signal }, 'Closing API server');

    void app
      .close()
      .then(() => {
        process.exitCode = 0;
      })
      .catch((error: unknown) => {
        app.log.error(error, 'Error while closing API server');
        process.exitCode = 1;
      });
  });
}

async function start() {
  try {
    const port = env.PORT;
    const host = env.HOST;
    const address = await app.listen({ host, port });
    app.log.info({ address }, 'API server listening');
  } catch (error) {
    app.log.error(error, 'Unable to start API server');
    process.exitCode = 1;
  }
}

void start();
