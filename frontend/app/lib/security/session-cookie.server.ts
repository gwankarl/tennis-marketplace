const SESSION_COOKIE_NAME = 'tx_session';
const SESSION_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function isCanonicalSessionCredential(value: string): boolean {
  if (!SESSION_CREDENTIAL_PATTERN.test(value)) {
    return false;
  }

  const bytes = Buffer.from(value, 'base64url');

  return bytes.byteLength === 32 && bytes.toString('base64url') === value;
}

/**
 * Reads exactly one canonical session credential from the request cookie.
 * This helper is server-only; never pass its result to route data or UI.
 */
export function readSessionCredential(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  const prefix = `${SESSION_COOKIE_NAME}=`;
  const matches = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(prefix));

  if (matches.length !== 1) {
    return null;
  }

  const credential = matches[0]!.slice(prefix.length);

  return isCanonicalSessionCredential(credential) ? credential : null;
}

/**
 * Creates a host-only session cookie whose lifetime cannot exceed the
 * backend-provided absolute session expiry.
 */
export function createSessionCookie(
  credential: string,
  absoluteExpiresAt: string | Date,
  now = Date.now(),
): string | null {
  if (!isCanonicalSessionCredential(credential)) {
    return null;
  }

  const expiresAt =
    absoluteExpiresAt instanceof Date
      ? absoluteExpiresAt.getTime()
      : Date.parse(absoluteExpiresAt);

  if (!Number.isFinite(expiresAt) || !Number.isFinite(now)) {
    return null;
  }

  // Floor the remaining lifetime so the browser cookie cannot outlive the
  // backend's absolute expiry due to rounding.
  const maxAgeSeconds = Math.floor((expiresAt - now) / 1000);

  if (maxAgeSeconds < 1) {
    return null;
  }

  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';

  return (
    `${SESSION_COOKIE_NAME}=${credential}` +
    `; Path=/; Max-Age=${maxAgeSeconds}` +
    '; HttpOnly; SameSite=Lax' +
    secure
  );
}

/** Clears the session cookie using the same name and path as its setter. */
export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';

  return (
    `${SESSION_COOKIE_NAME}=` +
    '; Path=/; Max-Age=0' +
    '; Expires=Thu, 01 Jan 1970 00:00:00 GMT' +
    '; HttpOnly; SameSite=Lax' +
    secure
  );
}
