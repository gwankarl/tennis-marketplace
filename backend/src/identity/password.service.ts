import { createHash } from 'node:crypto';
import argon2 from 'argon2';
import { ApplicationError } from '../http/application-error.js';

const ARGON2_MEMORY_COST_KIB = 19_456;
const ARGON2_TIME_COST = 2;
const ARGON2_PARALLELISM = 1;

const HIBP_RANGE_ENDPOINT = 'https://api.pwnedpasswords.com/range/';
const HIBP_USER_AGENT = 'Tennis-Xpress/0.1';
const HIBP_TIMEOUT_MS = 5_000;
const MAX_HIBP_TIMEOUT_MS = 5_000;
const MAX_HIBP_RESPONSE_BYTES = 128 * 1024;
const SHA1_PREFIX_LENGTH = 5;

export type PasswordScreeningResult = 'clear' | 'compromised';

export interface PasswordService {
  hashPassword(password: string): Promise<string>;
  verifyPassword(passwordHash: string, password: string): Promise<boolean>;
  screenPassword(password: string): Promise<PasswordScreeningResult>;
}

/**
 * Reads a bounded HIBP response body. The timeout controller remains active
 * while the stream is read, not only while response headers are received.
 */
async function readBoundedResponseText(response: Response): Promise<string> {
  if (!response.body) {
    throw new Error('Missing response body.');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (!value) {
        throw new Error('Invalid response chunk.');
      }

      totalBytes += value.byteLength;

      if (totalBytes > MAX_HIBP_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The request will be rejected regardless of cancellation success.
        }

        throw new Error('Response body exceeded the size limit.');
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function hasPositiveSuffixMatch(
  responseText: string,
  expectedSuffix: string,
): boolean {
  const lines = responseText.split(/\r?\n/);

  if (lines.at(-1) === '') {
    lines.pop();
  }

  if (lines.length === 0) {
    throw new Error('Empty range response.');
  }

  const seenSuffixes = new Set<string>();
  let matched = false;

  for (const line of lines) {
    const separatorIndex = line.indexOf(':');

    if (separatorIndex === -1) {
      throw new Error('Invalid range response row.');
    }

    const suffix = line.slice(0, separatorIndex);
    const countText = line.slice(separatorIndex + 1);

    if (!/^[A-Fa-f0-9]{35}$/.test(suffix) || !/^[0-9]+$/.test(countText)) {
      throw new Error('Invalid range response row.');
    }

    const normalizedSuffix = suffix.toUpperCase();
    const count = Number(countText);

    if (!Number.isSafeInteger(count) || seenSuffixes.has(normalizedSuffix)) {
      throw new Error('Invalid range response data.');
    }

    seenSuffixes.add(normalizedSuffix);

    if (normalizedSuffix === expectedSuffix && count > 0) {
      matched = true;
    }
  }

  return matched;
}

/**
 * Creates the password service. The fetch implementation is injectable for
 * deterministic tests; the HIBP destination remains fixed in this module.
 * Timeout overrides are capped at the production maximum.
 */
export function createPasswordService(
  fetchImplementation: typeof fetch = fetch,
  requestedTimeoutMs = HIBP_TIMEOUT_MS,
): PasswordService {
  const timeoutMs =
    Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
      ? Math.min(requestedTimeoutMs, MAX_HIBP_TIMEOUT_MS)
      : HIBP_TIMEOUT_MS;

  async function hashPassword(password: string): Promise<string> {
    // Omitting `salt` makes the library generate an independent random salt.
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: ARGON2_MEMORY_COST_KIB,
      timeCost: ARGON2_TIME_COST,
      parallelism: ARGON2_PARALLELISM,
    });
  }

  async function verifyPassword(
    passwordHash: string,
    password: string,
  ): Promise<boolean> {
    return argon2.verify(passwordHash, password);
  }

  async function screenPassword(
    password: string,
  ): Promise<PasswordScreeningResult> {
    // SHA-1 is used only for HIBP's range lookup, never for credential storage.
    const fullHash = createHash('sha1')
      .update(password, 'utf8')
      .digest('hex')
      .toUpperCase();
    const prefix = fullHash.slice(0, SHA1_PREFIX_LENGTH);
    const suffix = fullHash.slice(SHA1_PREFIX_LENGTH);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImplementation(
        `${HIBP_RANGE_ENDPOINT}${prefix}`,
        {
          method: 'GET',
          headers: {
            'Add-Padding': 'true',
            'user-agent': HIBP_USER_AGENT,
          },
          redirect: 'error',
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error('HIBP returned an unsuccessful status.');
      }

      const responseText = await readBoundedResponseText(response);
      const compromised = hasPositiveSuffixMatch(responseText, suffix);

      return compromised ? 'compromised' : 'clear';
    } catch {
      throw new ApplicationError(
        'SERVICE_UNAVAILABLE',
        'Password screening is temporarily unavailable.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return { hashPassword, verifyPassword, screenPassword };
}

const passwordService = createPasswordService();

export const hashPassword = passwordService.hashPassword;
export const verifyPassword = passwordService.verifyPassword;
export const screenPassword = passwordService.screenPassword;
