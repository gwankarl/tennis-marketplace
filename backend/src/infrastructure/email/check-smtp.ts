import 'dotenv/config';
import { parseEmailSmtpConfig } from '../../config/email-env.js';
import { createSmtpEmailTransport } from './smtp-email-transport.js';
import type { SmtpEmailTransport } from './smtp-email-transport.js';

async function checkSmtp(): Promise<void> {
  let transport: SmtpEmailTransport | undefined;

  try {
    const config = parseEmailSmtpConfig(process.env);
    transport = createSmtpEmailTransport(config);
    await transport.verifyConnection();

    console.info(
      'SMTP connection and authentication verified. Message delivery was not tested.',
    );
  } catch {
    console.error(
      'SMTP verification failed. Check SMTP settings in backend/.env; values are not shown.',
    );
    process.exitCode = 1;
  } finally {
    transport?.close();
  }
}

void checkSmtp();
