import { describe, expect, it } from 'vitest';
import { parseEmailSmtpConfig } from '../../../src/config/email-env.js';

const validEnvironment = {
  EMAIL_SMTP_HOST: 'sandbox.smtp.mailtrap.io',
  EMAIL_SMTP_PORT: '2525',
  EMAIL_SMTP_USER: 'sandbox-user',
  EMAIL_SMTP_PASSWORD: 'private-password-marker',
  EMAIL_FROM_ADDRESS: 'tennis-xpress@example.test',
};

describe('parseEmailSmtpConfig', () => {
  it('parses Mailtrap SMTP settings without changing credentials', () => {
    expect(parseEmailSmtpConfig(validEnvironment)).toEqual({
      host: 'sandbox.smtp.mailtrap.io',
      port: 2525,
      username: 'sandbox-user',
      password: 'private-password-marker',
      fromAddress: 'tennis-xpress@example.test',
    });
  });

  it('reports missing settings without printing secret values', () => {
    expect(() => parseEmailSmtpConfig({})).toThrow(/EMAIL_SMTP_PASSWORD/);

    try {
      parseEmailSmtpConfig({});
    } catch (error) {
      expect((error as Error).message).not.toContain('private-password-marker');
    }
  });

  it('rejects unsupported ports without exposing credentials', () => {
    expect(() =>
      parseEmailSmtpConfig({
        ...validEnvironment,
        EMAIL_SMTP_PORT: '1234',
      }),
    ).toThrow(/EMAIL_SMTP_PORT/);
  });
});
