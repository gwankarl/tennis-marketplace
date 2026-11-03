const DEFAULT_POST_LOGIN_PATH = '/account';

/**
 * Only explicitly approved internal destinations are accepted. Keeping this
 * allowlist exact prevents external, protocol-relative, encoded, and
 * backslash-based redirect variants from reaching a redirect response.
 */
export function safeReturnTo(value: unknown): string {
  return value === DEFAULT_POST_LOGIN_PATH
    ? DEFAULT_POST_LOGIN_PATH
    : DEFAULT_POST_LOGIN_PATH;
}

/**
 * Reads a literal, unencoded returnTo query value. Encoded or duplicate values
 * fall back to the buyer overview.
 */
export function returnToFromRequestUrl(requestUrl: string): string {
  const rawQuery = new URL(requestUrl).search.slice(1);
  const values = rawQuery
    .split('&')
    .filter((entry) => entry.startsWith('returnTo='))
    .map((entry) => entry.slice('returnTo='.length));

  if (
    values.length !== 1 ||
    values[0]!.includes('%') ||
    values[0]!.includes('+')
  ) {
    return DEFAULT_POST_LOGIN_PATH;
  }

  return safeReturnTo(values[0]);
}
