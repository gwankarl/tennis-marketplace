import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '../../config/server-env.server';

const TOKEN_LIFETIME_SECONDS = 20 * 60;
const MAX_TOKEN_LENGTH = 256;
const BASE64URL_VALUE = /^[A-Za-z0-9_-]{43}$/;

function signature(payload: string, sessionCredential?: string): string {
  const hmac = createHmac('sha256', serverEnv.CSRF_SECRET).update(payload);

  if (sessionCredential !== undefined) {
    // Domain-separate authenticated-form tokens and bind them to one session.
    hmac.update('\0session\0').update(sessionCredential);
  }

  return hmac.digest('base64url');
}

function createToken(now: number, sessionCredential?: string): string {
  const issuedAt = Math.floor(now / 1000);
  const nonce = randomBytes(32).toString('base64url');
  const payload = `${issuedAt}.${nonce}`;

  return `${payload}.${signature(payload, sessionCredential)}`;
}

function isCanonicalSessionCredential(value: string): boolean {
  if (!BASE64URL_VALUE.test(value)) {
    return false;
  }

  const bytes = Buffer.from(value, 'base64url');

  return bytes.byteLength === 32 && bytes.toString('base64url') === value;
}

/** Creates the existing short-lived token for unauthenticated forms. */
export function createCsrfToken(now = Date.now()): string {
  return createToken(now);
}

/** Creates a CSRF token cryptographically bound to one authenticated session. */
export function createSessionCsrfToken(
  sessionCredential: string,
  now = Date.now(),
): string {
  if (!isCanonicalSessionCredential(sessionCredential)) {
    throw new Error('Cannot create a CSRF token for an invalid session.');
  }

  return createToken(now, sessionCredential);
}

function isTrustedRequest(
  origin: string | null,
  token: string,
  sessionCredential: string | undefined,
  now: number,
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
    !/^\d{10}$/.test(issuedAtText!) ||
    !BASE64URL_VALUE.test(nonce!) ||
    !BASE64URL_VALUE.test(providedSignature!)
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
  const expected = Buffer.from(
    signature(payload, sessionCredential),
    'base64url',
  );
  const received = Buffer.from(providedSignature!, 'base64url');

  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

/**
 * Checks same-origin and signed-token protections for existing public forms.
 * Their token format and validation remain unchanged.
 */
export function isTrustedRegistrationRequest(
  origin: string | null,
  token: string,
  now = Date.now(),
): boolean {
  return isTrustedRequest(origin, token, undefined, now);
}

/** Checks same-origin protection and a CSRF token bound to the supplied session. */
export function isTrustedSessionRequest(
  origin: string | null,
  token: string,
  sessionCredential: string,
  now = Date.now(),
): boolean {
  if (!isCanonicalSessionCredential(sessionCredential)) {
    return false;
  }

  return isTrustedRequest(origin, token, sessionCredential, now);
}
