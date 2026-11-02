import { z } from 'zod';

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
