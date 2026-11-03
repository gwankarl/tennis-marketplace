import { z } from 'zod';

function isValidLoginRateLimitHmacKey(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    return false;
  }

  const decoded = Buffer.from(value, 'base64url');

  return decoded.byteLength === 32 && decoded.toString('base64url') === value;
}

const backendEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === 'postgres:' || protocol === 'postgresql:';
    }),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.preprocess(
    (value) => (value === undefined ? 3000 : Number(value)),
    z.number().int().min(1).max(65535),
  ),
  LOGIN_RATE_LIMIT_HMAC_KEY: z.string().refine(isValidLoginRateLimitHmacKey),
  LOGIN_RATE_LIMIT_IP_MAX: z.preprocess(
    (value) => (value === undefined ? 20 : Number(value)),
    z.number().int().min(1).max(1000),
  ),
  LOGIN_RATE_LIMIT_EMAIL_MAX: z.preprocess(
    (value) => (value === undefined ? 10 : Number(value)),
    z.number().int().min(1).max(1000),
  ),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.preprocess(
    (value) => (value === undefined ? 900_000 : Number(value)),
    z.number().int().min(1).max(86_400_000),
  ),
  REGISTRATION_RATE_LIMIT_MAX: z.preprocess(
    (value) => (value === undefined ? 5 : Number(value)),
    z.number().int().min(1).max(1000),
  ),
  REGISTRATION_RATE_LIMIT_WINDOW_MS: z.preprocess(
    (value) => (value === undefined ? 900_000 : Number(value)),
    z.number().int().min(1).max(86_400_000),
  ),
  RESEND_VERIFICATION_IP_RATE_LIMIT_MAX: z.preprocess(
    (value) => (value === undefined ? 5 : Number(value)),
    z.number().int().min(1).max(1000),
  ),
  RESEND_VERIFICATION_IP_RATE_LIMIT_WINDOW_MS: z.preprocess(
    (value) => (value === undefined ? 3_600_000 : Number(value)),
    z.number().int().min(1).max(86_400_000),
  ),
  RESEND_VERIFICATION_ACCOUNT_MAX_PER_HOUR: z.preprocess(
    (value) => (value === undefined ? 5 : Number(value)),
    z.number().int().min(1).max(1000),
  ),
  RESEND_VERIFICATION_ACCOUNT_COOLDOWN_MS: z.preprocess(
    (value) => (value === undefined ? 60_000 : Number(value)),
    z.number().int().min(1).max(86_400_000),
  ),
  TERMS_VERSION: z.string().trim().min(1).max(64),
});

export function parseBackendEnv(source: NodeJS.ProcessEnv) {
  const result = backendEnvSchema.safeParse(source);

  if (!result.success) {
    const invalidVariables = [
      ...new Set(
        result.error.issues.map((issue) =>
          String(issue.path[0] ?? 'environment'),
        ),
      ),
    ].join(', ');

    throw new Error(
      `Invalid backend configuration for ${invalidVariables}. Check backend/.env.example. Values are not shown.`,
    );
  }

  return result.data;
}
