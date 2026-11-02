import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { EmailQueueConfig } from '../../config/email-queue-env.js';

const FORMAT_VERSION = 'v1';
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MAX_PAYLOAD_BYTES = 4096;
const MAX_SERIALIZED_LENGTH = 6000;

const deliveryPayloadSchema = z
  .object({
    recipientEmail: z.string().email().max(320),
    verificationUrl: z.string().url().max(2048),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type VerificationDeliveryPayload = z.infer<typeof deliveryPayloadSchema>;

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

export function encryptDeliveryPayload(
  payload: VerificationDeliveryPayload,
  jobId: string,
  purpose: string,
  config: EmailQueueConfig,
): EncryptedDeliveryPayload {
  const parsed = deliveryPayloadSchema.safeParse(payload);

  if (!parsed.success || config.activeKey.key.length !== 32) {
    throw new EncryptedDeliveryPayloadError();
  }

  const plaintext = Buffer.from(JSON.stringify(parsed.data), 'utf8');
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

/**
 * Decrypts and validates a payload. Parsing, authentication, and schema errors
 * become the same safe error; raw payload or crypto details are never retained.
 */
export function decryptDeliveryPayload(
  encrypted: EncryptedDeliveryPayload,
  jobId: string,
  purpose: string,
  config: EmailQueueConfig,
): VerificationDeliveryPayload {
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

    const parsed = deliveryPayloadSchema.safeParse(
      JSON.parse(plaintext.toString('utf8')),
    );

    if (!parsed.success) {
      throw new EncryptedDeliveryPayloadError();
    }

    return parsed.data;
  } catch {
    throw new EncryptedDeliveryPayloadError();
  }
}
