import 'dotenv/config';

import { parseEmailSmtpConfig } from '../../config/email-env.js';
import { parseEmailQueueConfig } from '../../config/email-queue-env.js';
import { parseEmailWorkerConfig } from '../../config/email-worker-env.js';
import { closeDatabase, db } from '../../db/client.js';
import { createEmailDeliveryRepository } from '../../identity/email-delivery.repository.js';
import { createEmailDeliveryWorker } from '../../identity/email-delivery-worker.service.js';
import { createSmtpEmailTransport } from './smtp-email-transport.js';

async function main(): Promise<void> {
  const queueConfig = parseEmailQueueConfig(process.env);
  const smtpConfig = parseEmailSmtpConfig(process.env);
  const workerConfig = parseEmailWorkerConfig(process.env);
  const transport = createSmtpEmailTransport(smtpConfig);
  const worker = createEmailDeliveryWorker({
    repository: createEmailDeliveryRepository(db),
    transport,
    queueConfig,
    workerConfig,
    onDiagnostic: (event) => {
      console.info(JSON.stringify(event));
    },
  });

  const shutdown = new AbortController();
  const stop = () => shutdown.abort();

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    console.info('Email delivery worker started.');
    await worker.run(shutdown.signal);
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    transport.close();
    await closeDatabase();
    console.info('Email delivery worker stopped.');
  }
}

void main().catch(() => {
  console.error(
    'Email delivery worker failed to start or stop. Check local configuration and service availability; values are not shown.',
  );
  process.exitCode = 1;
});
