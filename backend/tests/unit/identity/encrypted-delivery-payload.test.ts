import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EmailQueueConfig } from '../../../src/config/email-queue-env.js';
import {
  decryptDeliveryPayload,
  encryptDeliveryPayload,
  EncryptedDeliveryPayloadError,
  type VerificationDeliveryPayload,
} from '../../../src/modules/identity/verification/delivery/encrypted-delivery-payload.js';

const config: EmailQueueConfig = {
  activeKey: {
    keyId: 'test-key-v1',
    key: Buffer.alloc(32, 7),
  },
  frontendOrigin: 'http://localhost:5173',
};

const jobId = '00000000-0000-4000-8000-000000000001';
const purpose = 'email_verification';

const payload: VerificationDeliveryPayload = {
  recipientEmail: 'person@example.test',
  verificationUrl:
    'http://localhost:5173/verify-email?token=abcdefghijklmnopqrstuvwxyz1234567890123456789',
  expiresAt: '2026-11-03T12:00:00.000Z',
};

function encryptedMalformedJson(): {
  keyId: string;
  serialized: string;
} {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.activeKey.key, nonce, {
    authTagLength: 16,
  });
  cipher.setAAD(
    Buffer.from(
      JSON.stringify(['tennis-xpress-email-delivery', 'v1', jobId, purpose]),
      'utf8',
    ),
  );
  const ciphertext = Buffer.concat([
    cipher.update('{not-json', 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    keyId: config.activeKey.keyId,
    serialized: [
      'v1',
      nonce.toString('base64url'),
      authTag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.'),
  };
}

describe('encrypted verification delivery payloads', () => {
  it('encrypts and decrypts a validated payload', () => {
    const encrypted = encryptDeliveryPayload(payload, jobId, purpose, config);

    expect(encrypted.serialized).toMatch(/^v1\./);
    expect(encrypted.serialized).not.toContain(payload.recipientEmail);
    expect(encrypted.serialized).not.toContain('abcdefghijklmnopqrstuvwxyz');

    expect(decryptDeliveryPayload(encrypted, jobId, purpose, config)).toEqual(
      payload,
    );
  });

  it('rejects tampered ciphertext without leaking details', () => {
    const encrypted = encryptDeliveryPayload(payload, jobId, purpose, config);
    const parts = encrypted.serialized.split('.');
    const ciphertext = parts[3];
    const replacement = ciphertext[0] === 'A' ? 'B' : 'A';
    parts[3] = `${replacement}${ciphertext.slice(1)}`;

    expect(() =>
      decryptDeliveryPayload(
        { ...encrypted, serialized: parts.join('.') },
        jobId,
        purpose,
        config,
      ),
    ).toThrow(EncryptedDeliveryPayloadError);
  });

  it('rejects a wrong key, job ID, purpose, and key ID', () => {
    const encrypted = encryptDeliveryPayload(payload, jobId, purpose, config);
    const wrongKey = {
      ...config,
      activeKey: {
        keyId: config.activeKey.keyId,
        key: Buffer.alloc(32, 8),
      },
    };

    expect(() =>
      decryptDeliveryPayload(encrypted, jobId, purpose, wrongKey),
    ).toThrow(EncryptedDeliveryPayloadError);
    expect(() =>
      decryptDeliveryPayload(
        encrypted,
        `${jobId.slice(0, -1)}2`,
        purpose,
        config,
      ),
    ).toThrow(EncryptedDeliveryPayloadError);
    expect(() =>
      decryptDeliveryPayload(encrypted, jobId, 'another_purpose', config),
    ).toThrow(EncryptedDeliveryPayloadError);
    expect(() =>
      decryptDeliveryPayload(
        { ...encrypted, keyId: 'unknown-key' },
        jobId,
        purpose,
        config,
      ),
    ).toThrow(EncryptedDeliveryPayloadError);
  });

  it('rejects malformed envelopes and authenticated but malformed JSON safely', () => {
    expect(() =>
      decryptDeliveryPayload(
        { keyId: config.activeKey.keyId, serialized: 'malformed' },
        jobId,
        purpose,
        config,
      ),
    ).toThrow(EncryptedDeliveryPayloadError);

    expect(() =>
      decryptDeliveryPayload(encryptedMalformedJson(), jobId, purpose, config),
    ).toThrow(EncryptedDeliveryPayloadError);
  });
});
