// Load and validate DATABASE_URL; this does not open a database connection.
import { env } from './config/runtime-env.js';
import { buildApp } from './app.js';

const app = buildApp();
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
