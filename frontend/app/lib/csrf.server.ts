import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '../config/server-env.server';

const TOKEN_LIFETIME_SECONDS = 20 * 60;
const MAX_TOKEN_LENGTH = 256;
const BASE64URL_VALUE = /^[A-Za-z0-9_-]{43}$/;

function signature(payload: string): string {
  return createHmac('sha256', serverEnv.CSRF_SECRET)
    .update(payload)
    .digest('base64url');
}

/** Creates a short-lived form token; it is not an authentication credential. */
export function createCsrfToken(now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000);
  const nonce = randomBytes(32).toString('base64url');
  const payload = `${issuedAt}.${nonce}`;

  return `${payload}.${signature(payload)}`;
}

/**
 * Requires both a same-origin browser submission and a valid signed form token.
 * Missing, opaque, malformed, expired, or cross-origin submissions are rejected.
 */
export function isTrustedRegistrationRequest(
  origin: string | null,
  token: string,
  now = Date.now(),
): boolean {
  if (!origin || origin === 'null' || token.length > MAX_TOKEN_LENGTH) {
    return false;
  }

  try {
    if (new URL(origin).origin !== serverEnv.APP_ORIGIN) {
      return false;
    }
  } catch {
    return false;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }

  const [issuedAtText, nonce, providedSignature] = parts;

  if (
    !/^\d{10}$/.test(issuedAtText) ||
    !BASE64URL_VALUE.test(nonce) ||
    !BASE64URL_VALUE.test(providedSignature)
  ) {
    return false;
  }

  const issuedAt = Number(issuedAtText);
  const nowSeconds = Math.floor(now / 1000);

  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > nowSeconds + 60 ||
    nowSeconds - issuedAt > TOKEN_LIFETIME_SECONDS
  ) {
    return false;
  }

  const payload = `${issuedAtText}.${nonce}`;
  const expected = Buffer.from(signature(payload), 'base64url');
  const received = Buffer.from(providedSignature, 'base64url');

  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
