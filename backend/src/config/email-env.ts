import { z } from 'zod';

const emailSmtpEnvSchema = z.object({
  EMAIL_SMTP_HOST: z.string().trim().min(1).max(253),
  EMAIL_SMTP_PORT: z.preprocess(
    (value) => (value === undefined ? value : Number(value)),
    z.union([z.literal(25), z.literal(465), z.literal(587), z.literal(2525)]),
  ),
  EMAIL_SMTP_USER: z.string().min(1),
  EMAIL_SMTP_PASSWORD: z.string().min(1),
  EMAIL_FROM_ADDRESS: z.string().trim().email(),
});

export interface EmailSmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  fromAddress: string;
}

/** Parses SMTP settings only for commands that explicitly use email transport. */
export function parseEmailSmtpConfig(
  source: NodeJS.ProcessEnv,
): EmailSmtpConfig {
  const result = emailSmtpEnvSchema.safeParse(source);

  if (!result.success) {
    const invalidVariables = [
      ...new Set(
        result.error.issues.map((issue) =>
          String(issue.path[0] ?? 'email configuration'),
        ),
      ),
    ].join(', ');

    throw new Error(
      `Invalid SMTP configuration for ${invalidVariables}. Values are not shown.`,
    );
  }

  return {
    host: result.data.EMAIL_SMTP_HOST,
    port: result.data.EMAIL_SMTP_PORT,
    username: result.data.EMAIL_SMTP_USER,
    password: result.data.EMAIL_SMTP_PASSWORD,
    fromAddress: result.data.EMAIL_FROM_ADDRESS,
  };
}
