import nodemailer from 'nodemailer';
import type { EmailSmtpConfig } from '../../config/email-env.js';
import {
  EmailTransportError,
  type EmailTransport,
  type OutboundEmail,
} from './email-transport.js';

const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 5_000;
const SOCKET_TIMEOUT_MS = 10_000;

interface SmtpMessage extends OutboundEmail {
  from: string;
}

interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  logger: false;
  debug: false;
  tls: {
    rejectUnauthorized: true;
    servername: string;
  };
}

export interface SmtpTransporter {
  sendMail(message: SmtpMessage): Promise<unknown>;
  verify(): Promise<boolean>;
  close(): void;
}

export type SmtpTransporterFactory = (
  options: SmtpTransportOptions,
) => SmtpTransporter;

export interface SmtpEmailTransport extends EmailTransport {
  /** Checks SMTP connection and authentication; it does not send a message. */
  verifyConnection(): Promise<void>;
  close(): void;
}

function createNodemailerTransporter(
  options: SmtpTransportOptions,
): SmtpTransporter {
  const transporter = nodemailer.createTransport(options);

  return {
    sendMail: (message) => transporter.sendMail(message),
    verify: () => transporter.verify(),
    close: () => transporter.close(),
  };
}

/**
 * Creates an SMTP adapter. Port 465 uses implicit TLS; the other supported
 * ports require STARTTLS. Certificate verification remains enabled.
 */
export function createSmtpEmailTransport(
  config: EmailSmtpConfig,
  createTransporter: SmtpTransporterFactory = createNodemailerTransporter,
): SmtpEmailTransport {
  const secure = config.port === 465;
  const transporter = createTransporter({
    host: config.host,
    port: config.port,
    secure,
    requireTLS: !secure,
    auth: {
      user: config.username,
      pass: config.password,
    },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    logger: false,
    debug: false,
    tls: {
      rejectUnauthorized: true,
      servername: config.host,
    },
  });

  return {
    async send(message) {
      try {
        await transporter.sendMail({
          from: config.fromAddress,
          ...message,
        });
      } catch (error) {
        throw new EmailTransportError(failureKind(error));
      }
    },

    async verifyConnection() {
      try {
        const verified = await transporter.verify();
        if (!verified) {
          throw new Error('SMTP verification returned false.');
        }
      } catch {
        throw new EmailTransportError();
      }
    },

    close() {
      transporter.close();
    },
  };
}

function failureKind(error: unknown): 'transient' | 'permanent' {
  if (
    typeof error === 'object' &&
    error !== null &&
    'responseCode' in error &&
    typeof error.responseCode === 'number' &&
    error.responseCode >= 500 &&
    error.responseCode <= 599
  ) {
    return 'permanent';
  }

  return 'transient';
}
