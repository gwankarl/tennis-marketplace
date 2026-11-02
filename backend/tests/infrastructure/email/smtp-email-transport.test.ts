import { describe, expect, it, vi } from 'vitest';
import type { EmailSmtpConfig } from '../../../src/config/email-env.js';
import {
  EmailTransportError,
  type OutboundEmail,
} from '../../../src/infrastructure/email/email-transport.js';
import {
  createSmtpEmailTransport,
  type SmtpTransporter,
  type SmtpTransporterFactory,
} from '../../../src/infrastructure/email/smtp-email-transport.js';

const config: EmailSmtpConfig = {
  host: 'sandbox.smtp.mailtrap.io',
  port: 2525,
  username: 'sandbox-user',
  password: 'sandbox-password',
  fromAddress: 'tennis-xpress@example.test',
};

const message: OutboundEmail = {
  to: 'recipient@example.test',
  subject: 'Test message',
  text: 'Test body',
};

function makeTransporter(): SmtpTransporter {
  return {
    sendMail: vi.fn<SmtpTransporter['sendMail']>().mockResolvedValue(undefined),
    verify: vi.fn<SmtpTransporter['verify']>().mockResolvedValue(true),
    close: vi.fn(),
  };
}

describe('SMTP email transport', () => {
  it('sends one message with the configured sender', async () => {
    const transporter = makeTransporter();
    const factory = vi.fn<SmtpTransporterFactory>(() => transporter);
    const transport = createSmtpEmailTransport(config, factory);

    await transport.send(message);

    expect(transporter.sendMail).toHaveBeenCalledOnce();
    expect(transporter.sendMail).toHaveBeenCalledWith({
      from: config.fromAddress,
      ...message,
    });
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        host: config.host,
        port: 2525,
        secure: false,
        requireTLS: true,
        connectionTimeout: 10_000,
        greetingTimeout: 5_000,
        socketTimeout: 10_000,
        logger: false,
        debug: false,
        tls: {
          rejectUnauthorized: true,
          servername: config.host,
        },
      }),
    );
  });

  it('uses implicit TLS on port 465', async () => {
    const transporter = makeTransporter();
    const factory = vi.fn<SmtpTransporterFactory>(() => transporter);

    createSmtpEmailTransport({ ...config, port: 465 }, factory);

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 465,
        secure: true,
        requireTLS: false,
      }),
    );
  });

  it('converts SMTP failures to a safe error without retaining details', async () => {
    const transporter = makeTransporter();
    const sensitiveError = new Error(
      'recipient@example.test token=secret smtp://user:password@host',
    );
    vi.mocked(transporter.sendMail).mockRejectedValue(sensitiveError);

    const transport = createSmtpEmailTransport(config, () => transporter);

    let caught: unknown;
    try {
      await transport.send(message);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EmailTransportError);
    expect((caught as Error).message).toBe('Email transport attempt failed.');
    expect(JSON.stringify(caught)).not.toMatch(
      /recipient@example\.test|secret|password|smtp:\/\/|token=/,
    );
    expect(transporter.sendMail).toHaveBeenCalledOnce();
  });

  it('uses the injected transporter for an explicit connection check', async () => {
    const transporter = makeTransporter();
    const transport = createSmtpEmailTransport(config, () => transporter);

    await expect(transport.verifyConnection()).resolves.toBeUndefined();
    expect(transporter.verify).toHaveBeenCalledOnce();

    transport.close();
    expect(transporter.close).toHaveBeenCalledOnce();
  });
});
