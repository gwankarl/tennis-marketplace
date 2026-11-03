import { createHash, randomBytes } from 'node:crypto';

const SESSION_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Generates a 256-bit opaque credential for one device session. */
export function createSessionCredential(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Returns the SHA-256 hex digest for a canonical 32-byte session credential.
 * Invalid credentials are rejected before any database lookup.
 */
export function hashSessionCredential(credential: string): string | null {
  if (!SESSION_CREDENTIAL_PATTERN.test(credential)) {
    return null;
  }

  const bytes = Buffer.from(credential, 'base64url');

  if (bytes.byteLength !== 32 || bytes.toString('base64url') !== credential) {
    return null;
  }

  return createHash('sha256').update(bytes).digest('hex');
}
