import { z } from 'zod';

const testDatabaseEnvSchema = z.object({
  TEST_DATABASE_URL: z.string().url(),
});

const unsafeConfigurationMessage =
  'Unsafe integration database configuration: TEST_DATABASE_URL must target database tennis_xpress_test using login tennis_xpress_test. No connection was opened.';

export function parseTestDatabaseUrl(source: NodeJS.ProcessEnv): string {
  const result = testDatabaseEnvSchema.safeParse(source);

  if (!result.success) {
    throw new Error(
      'Integration tests require a valid TEST_DATABASE_URL. No connection was opened.',
    );
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(result.data.TEST_DATABASE_URL);
  } catch {
    throw new Error(unsafeConfigurationMessage);
  }

  let username: string;

  try {
    username = decodeURIComponent(parsedUrl.username);
  } catch {
    throw new Error(unsafeConfigurationMessage);
  }

  if (
    !['postgres:', 'postgresql:'].includes(parsedUrl.protocol) ||
    parsedUrl.pathname !== '/tennis_xpress_test' ||
    username !== 'tennis_xpress_test' ||
    parsedUrl.password.length === 0
  ) {
    throw new Error(unsafeConfigurationMessage);
  }

  return result.data.TEST_DATABASE_URL;
}
