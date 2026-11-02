import { z } from 'zod';

const workerEnvSchema = z.object({
  EMAIL_WORKER_POLL_INTERVAL_MS: z.preprocess(
    (value) => (value === undefined ? 1_000 : Number(value)),
    z.number().int().min(250).max(60_000),
  ),
  EMAIL_WORKER_CONCURRENCY: z.preprocess(
    (value) => (value === undefined ? 2 : Number(value)),
    z.number().int().min(1).max(10),
  ),
  EMAIL_WORKER_LEASE_MS: z.preprocess(
    (value) => (value === undefined ? 120_000 : Number(value)),
    z.number().int().min(60_000).max(600_000),
  ),
  EMAIL_WORKER_RETRY_BASE_MS: z.preprocess(
    (value) => (value === undefined ? 30_000 : Number(value)),
    z.number().int().min(1_000).max(900_000),
  ),
  EMAIL_WORKER_RETRY_MAX_MS: z.preprocess(
    (value) => (value === undefined ? 900_000 : Number(value)),
    z.number().int().min(1_000).max(3_600_000),
  ),
});

export interface EmailWorkerConfig {
  pollIntervalMs: number;
  concurrency: number;
  leaseMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  maxAttempts: 5;
}

export function parseEmailWorkerConfig(
  source: NodeJS.ProcessEnv,
): EmailWorkerConfig {
  const result = workerEnvSchema.safeParse(source);

  if (
    !result.success ||
    (result.success &&
      result.data.EMAIL_WORKER_RETRY_BASE_MS >
        result.data.EMAIL_WORKER_RETRY_MAX_MS)
  ) {
    throw new Error(
      'Invalid email worker configuration. Check backend/.env.example; values are not shown.',
    );
  }

  return {
    pollIntervalMs: result.data.EMAIL_WORKER_POLL_INTERVAL_MS,
    concurrency: result.data.EMAIL_WORKER_CONCURRENCY,
    leaseMs: result.data.EMAIL_WORKER_LEASE_MS,
    retryBaseMs: result.data.EMAIL_WORKER_RETRY_BASE_MS,
    retryMaxMs: result.data.EMAIL_WORKER_RETRY_MAX_MS,
    maxAttempts: 5,
  };
}
