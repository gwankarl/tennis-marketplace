import 'dotenv/config';

const apiBaseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';

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

export const serverEnv = {
  API_BASE_URL: apiBaseUrl,
};
