import 'dotenv/config';
import { randomBytes } from 'node:crypto';

const apiBaseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';
const isProduction = process.env.NODE_ENV === 'production';
const appOrigin =
  process.env.APP_ORIGIN ??
  (isProduction ? undefined : 'http://localhost:5173');

let parsedApiBaseUrl: URL;
try {
  parsedApiBaseUrl = new URL(apiBaseUrl);
} catch {
  throw new Error(
    'Invalid frontend server configuration: API_BASE_URL must be an absolute HTTP(S) URL.',
  );
}

if (
  !['http:', 'https:'].includes(parsedApiBaseUrl.protocol) ||
  parsedApiBaseUrl.username ||
  parsedApiBaseUrl.password
) {
  throw new Error(
    'Invalid frontend server configuration: API_BASE_URL must be an absolute HTTP(S) URL without credentials.',
  );
}

if (!appOrigin) {
  throw new Error(
    'Invalid frontend server configuration: APP_ORIGIN is required in production.',
  );
}

let parsedAppOrigin: URL;
try {
  parsedAppOrigin = new URL(appOrigin);
} catch {
  throw new Error(
    'Invalid frontend server configuration: APP_ORIGIN must be an absolute HTTP(S) origin.',
  );
}

if (
  !['http:', 'https:'].includes(parsedAppOrigin.protocol) ||
  parsedAppOrigin.username ||
  parsedAppOrigin.password ||
  parsedAppOrigin.pathname !== '/' ||
  parsedAppOrigin.search ||
  parsedAppOrigin.hash
) {
  throw new Error(
    'Invalid frontend server configuration: APP_ORIGIN must be an origin without credentials, path, query, or fragment.',
  );
}

const csrfSecret =
  process.env.CSRF_SECRET ??
  (isProduction ? undefined : randomBytes(32).toString('base64url'));

if (!csrfSecret || csrfSecret.length < 32) {
  throw new Error(
    'Invalid frontend server configuration: production requires a unique CSRF_SECRET of at least 32 characters.',
  );
}

export const serverEnv = {
  API_BASE_URL: apiBaseUrl,
  APP_ORIGIN: parsedAppOrigin.origin,
  CSRF_SECRET: csrfSecret,
};
