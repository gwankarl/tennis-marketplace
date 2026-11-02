import { z } from 'zod';

const queueEnvSchema = z.object({
  EMAIL_QUEUE_ENCRYPTION_KEY_ID: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  EMAIL_QUEUE_ENCRYPTION_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  FRONTEND_ORIGIN: z.string().min(1).max(512),
});

export interface EmailQueueConfig {
  activeKey: {
    keyId: string;
    key: Buffer;
  };
  frontendOrigin: string;
}

export function parseEmailQueueConfig(
  source: NodeJS.ProcessEnv,
): EmailQueueConfig {
  const result = queueEnvSchema.safeParse(source);

  if (!result.success) {
    const invalidVariables = [
      ...new Set(
        result.error.issues.map((issue) =>
          String(issue.path[0] ?? 'email queue configuration'),
        ),
      ),
    ].join(', ');

    throw new Error(
      `Invalid email queue configuration for ${invalidVariables}. Values are not shown.`,
    );
  }

  const encodedKey = result.data.EMAIL_QUEUE_ENCRYPTION_KEY;
  const key = Buffer.from(encodedKey, 'base64');

  if (key.length !== 32 || key.toString('base64') !== encodedKey) {
    throw new Error(
      'Invalid email queue configuration for EMAIL_QUEUE_ENCRYPTION_KEY. Values are not shown.',
    );
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(result.data.FRONTEND_ORIGIN);
  } catch {
    throw new Error(
      'Invalid email queue configuration for FRONTEND_ORIGIN. Values are not shown.',
    );
  }

  if (
    !['http:', 'https:'].includes(parsedOrigin.protocol) ||
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.pathname !== '/' ||
    parsedOrigin.search ||
    parsedOrigin.hash ||
    (source.NODE_ENV === 'production' && parsedOrigin.protocol !== 'https:')
  ) {
    throw new Error(
      'Invalid email queue configuration for FRONTEND_ORIGIN. Values are not shown.',
    );
  }

  return {
    activeKey: {
      keyId: result.data.EMAIL_QUEUE_ENCRYPTION_KEY_ID,
      key,
    },
    frontendOrigin: parsedOrigin.origin,
  };
}
