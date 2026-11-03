import { z } from 'zod';

const verificationTokenSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]{43}$/);

/** The token is accepted only in a POST body, never in a URL. */
export const verifyEmailRequestSchema = z
  .object({
    token: verificationTokenSchema,
  })
  .strict();

export const verifyEmailAcknowledgementSchema = z
  .object({
    data: z
      .object({
        message: z.literal('Email address verified.'),
      })
      .strict(),
  })
  .strict();

export type VerifyEmailRequest = z.output<typeof verifyEmailRequestSchema>;
export type VerifyEmailAcknowledgement = z.output<
  typeof verifyEmailAcknowledgementSchema
>;
