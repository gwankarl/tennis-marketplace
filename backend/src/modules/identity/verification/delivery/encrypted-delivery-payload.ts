import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { EmailQueueConfig } from '../../../../config/email-queue-env.js';

const FORMAT_VERSION = 'v1';
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MAX_PAYLOAD_BYTES = 4096;
const MAX_SERIALIZED_LENGTH = 6000;

const verificationPayloadSchema = z
  .object({
    recipientEmail: z.string().email().max(320),
    verificationUrl: z.string().url().max(2048),
    expiresAt: z.string().datetime(),
  })
  .strict();

const passwordResetPayloadSchema = z
  .object({
    recipientEmail: z.string().email().max(320),
    passwordResetUrl: z.string().url().max(2048),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type VerificationDeliveryPayload = z.infer<
  typeof verificationPayloadSchema
>;

export type PasswordResetDeliveryPayload = z.infer<
  typeof passwordResetPayloadSchema
>;

type EmailDeliveryPurpose = 'email_verification' | 'password_reset';
type EmailDeliveryPayload =
  VerificationDeliveryPayload | PasswordResetDeliveryPayload;

export interface EncryptedDeliveryPayload {
  keyId: string;
  serialized: string;
}

export class EncryptedDeliveryPayloadError extends Error {
  constructor() {
    super('Encrypted delivery payload is invalid.');
    this.name = 'EncryptedDeliveryPayloadError';
  }
}

function additionalData(jobId: string, purpose: string): Buffer {
  return Buffer.from(
    JSON.stringify([
      'tennis-xpress-email-delivery',
      FORMAT_VERSION,
      jobId,
      purpose,
    ]),
    'utf8',
  );
}

function decodeBase64Url(value: string, expectedBytes?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new EncryptedDeliveryPayloadError();
  }

  const decoded = Buffer.from(value, 'base64url');

  if (
    decoded.toString('base64url') !== value ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes)
  ) {
    throw new EncryptedDeliveryPayloadError();
  }

  return decoded;
}

function parsePayload(
  payload: unknown,
  purpose: string,
): EmailDeliveryPayload | null {
  if (purpose === 'email_verification') {
    const parsed = verificationPayloadSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  }

  if (purpose === 'password_reset') {
    const parsed = passwordResetPayloadSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  }

  return null;
}

export function encryptDeliveryPayload(
  payload: VerificationDeliveryPayload,
  jobId: string,
  purpose: 'email_verification',
  config: EmailQueueConfig,
): EncryptedDeliveryPayload;
export function encryptDeliveryPayload(
  payload: PasswordResetDeliveryPayload,
  jobId: string,
  purpose: 'password_reset',
  config: EmailQueueConfig,
): EncryptedDeliveryPayload;
export function encryptDeliveryPayload(
  payload: EmailDeliveryPayload,
  jobId: string,
  purpose: EmailDeliveryPurpose,
  config: EmailQueueConfig,
): EncryptedDeliveryPayload {
  const parsed = parsePayload(payload, purpose);

  if (!parsed || config.activeKey.key.length !== 32) {
    throw new EncryptedDeliveryPayloadError();
  }

  const plaintext = Buffer.from(JSON.stringify(parsed), 'utf8');

  if (plaintext.length > MAX_PAYLOAD_BYTES) {
    throw new EncryptedDeliveryPayloadError();
  }

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', config.activeKey.key, nonce, {
    authTagLength: AUTH_TAG_BYTES,
  });

  cipher.setAAD(additionalData(jobId, purpose));

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const serialized = [
    FORMAT_VERSION,
    nonce.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');

  return {
    keyId: config.activeKey.keyId,
    serialized,
  };
}

export function decryptDeliveryPayload(
  encrypted: EncryptedDeliveryPayload,
  jobId: string,
  purpose: 'email_verification',
  config: EmailQueueConfig,
): VerificationDeliveryPayload;
export function decryptDeliveryPayload(
  encrypted: EncryptedDeliveryPayload,
  jobId: string,
  purpose: 'password_reset',
  config: EmailQueueConfig,
): PasswordResetDeliveryPayload;
export function decryptDeliveryPayload(
  encrypted: EncryptedDeliveryPayload,
  jobId: string,
  purpose: string,
  config: EmailQueueConfig,
): EmailDeliveryPayload;
export function decryptDeliveryPayload(
  encrypted: EncryptedDeliveryPayload,
  jobId: string,
  purpose: string,
  config: EmailQueueConfig,
): EmailDeliveryPayload {
  try {
    if (
      encrypted.keyId !== config.activeKey.keyId ||
      encrypted.serialized.length > MAX_SERIALIZED_LENGTH
    ) {
      throw new EncryptedDeliveryPayloadError();
    }

    const parts = encrypted.serialized.split('.');

    if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
      throw new EncryptedDeliveryPayloadError();
    }

    const nonce = decodeBase64Url(parts[1], NONCE_BYTES);
    const authTag = decodeBase64Url(parts[2], AUTH_TAG_BYTES);
    const ciphertext = decodeBase64Url(parts[3]);

    if (ciphertext.length === 0 || ciphertext.length > MAX_PAYLOAD_BYTES) {
      throw new EncryptedDeliveryPayloadError();
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      config.activeKey.key,
      nonce,
      { authTagLength: AUTH_TAG_BYTES },
    );

    decipher.setAAD(additionalData(jobId, purpose));
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    if (plaintext.length > MAX_PAYLOAD_BYTES) {
      throw new EncryptedDeliveryPayloadError();
    }

    const parsed = parsePayload(
      JSON.parse(plaintext.toString('utf8')) as unknown,
      purpose,
    );

    if (!parsed) {
      throw new EncryptedDeliveryPayloadError();
    }

    return parsed;
  } catch {
    throw new EncryptedDeliveryPayloadError();
  }
}
